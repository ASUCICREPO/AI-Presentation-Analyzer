'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useFaceLandmarker } from '../hooks/useFaceLandmarker';
import { useAudioAnalysis } from '../hooks/useAudioAnalysis';
import { ANALYSIS_CONFIG, PRESENTATION_LIMITS, DEFAULT_TIME_LIMIT_SEC, DATA_CHUNK_INTERVAL_MS, API_BASE_URL } from '../config/config';
import { useAuth } from '../context/AuthContext';

import { toast } from 'sonner';

// Import modular components
import PracticeSessionHeader from './practice/PracticeSessionHeader';
import CameraView from './practice/CameraView';
import CalibrationPanel from './practice/CalibrationPanel';
import RealTimeFeedbackPanel from './practice/RealTimeFeedbackPanel';
import TranscriptionPanel from './practice/TranscriptionPanel';

interface PracticeSessionProps {
  personaTitle: string;
  timeLimitSec?: number;
  sessionID: string;
  personaID: string;
  onBack: () => void;
  onComplete: (sessionID: string) => void;
}

export default function PracticeSession({ personaTitle, timeLimitSec, sessionID, personaID, onBack, onComplete }: PracticeSessionProps) {
  const { getIdToken } = useAuth();
  // Resolve the effective time cap for this session
  const maxDuration = timeLimitSec ?? DEFAULT_TIME_LIMIT_SEC;
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [timer, setTimer] = useState(0);
  const [cameraActive, setCameraActive] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  
  // MediaPipe & Tracking State
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastProcessTimeRef = useRef<number>(0);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  
  // Audio Feedback State
  const [soundEnabled, setSoundEnabled] = useState(true);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Eye Contact Logic Refs
  const lookAwayStartTimeRef = useRef<number | null>(null);
  const lookBackStartTimeRef = useRef<number | null>(null);
  const alertPlayedRef = useRef(false);

  // Chunk Upload Refs - track data for 15-second intervals
  const chunkIndexRef = useRef(0);
  const wpmSamplesRef = useRef<number[]>([]);
  const volumeSamplesRef = useRef<number[]>([]);
  const fillerWordsRef = useRef<{word: string; timestamp: number}[]>([]);
  const gazeEventsRef = useRef<{type: 'lookAway' | 'lookBack'; timestamp: number; duration?: number}[]>([]);
  const lastFillerCountRef = useRef(0);
  const lastChunkTimeRef = useRef<number>(0);

  // New Calibration Mode State
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [showMesh, setShowMesh] = useState(false);
  
  // Time-limit alert tracking (each fires once)
  const shownAlertsRef = useRef<Set<string>>(new Set());

  // Feedback State
  const [gazeStatus, setGazeStatus] = useState({
    isLookingAtScreen: true,
    message: 'Good Eye Contact',
    color: 'text-green-600',
    direction: 'Center'
  });

  // Audio Analysis Hook
  const {
    metrics: audioMetrics,
    transcripts,
    partialTranscript,
    isTranscribing,
    startAnalysis,
    pauseAnalysis,
    resumeAnalysis,
    stopAnalysis,
  } = useAudioAnalysis();
  
  // Hook initialization
  const {
    status: mpStatus,
    detectForVideo,
    drawResults,
  } = useFaceLandmarker({
    numFaces: 1,
    outputFaceBlendshapes: true,
    minFaceDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  // Initialize Audio Context (for alert sounds)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  const playAlertSound = useCallback(() => {
    if (!audioContextRef.current || !soundEnabled) return;
    
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }

    const ctx = audioContextRef.current;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    oscillator.frequency.setValueAtTime(ANALYSIS_CONFIG.AUDIO.FREQUENCY_START, ctx.currentTime);
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(ANALYSIS_CONFIG.AUDIO.GAIN_START, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(ANALYSIS_CONFIG.AUDIO.GAIN_END, ctx.currentTime + ANALYSIS_CONFIG.AUDIO.DURATION);
    
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + ANALYSIS_CONFIG.AUDIO.DURATION);
  }, [soundEnabled]);

  // Timer logic + time-limit enforcement
  useEffect(() => {
    let interval: NodeJS.Timeout;
    // Compute warning thresholds relative to the persona's time limit
    const warningAt = maxDuration - PRESENTATION_LIMITS.WARNING_REMAINING_SEC;
    const finalWarningAt = maxDuration - PRESENTATION_LIMITS.FINAL_WARNING_REMAINING_SEC;

    if (isRecording && !isPaused) {
      interval = setInterval(() => {
        setTimer((prev) => {
          // Cap timer at MAX so it never goes past / negative in the header
          if (prev >= maxDuration) return prev;

          const next = prev + 1;

          const remaining = maxDuration - next;
          const remMin = Math.floor(remaining / 60);
          const remSec = remaining % 60;
          const remLabel = remMin > 0 ? `${remMin} min${remSec > 0 ? ` ${remSec}s` : ''}` : `${remSec}s`;

          // First warning (e.g. 5 min remaining)
          if (warningAt > 0 && next === warningAt && !shownAlertsRef.current.has('warning')) {
            shownAlertsRef.current.add('warning');
            toast.info(`${remLabel} remaining`, {
              duration: PRESENTATION_LIMITS.ALERT_DISPLAY_MS,
            });
          }

          // Final warning (e.g. 1 min remaining)
          if (finalWarningAt > 0 && next === finalWarningAt && !shownAlertsRef.current.has('final')) {
            shownAlertsRef.current.add('final');
            toast.warning(`${remLabel} remaining — please wrap up`, {
              duration: PRESENTATION_LIMITS.ALERT_DISPLAY_MS,
            });
          }

          // Hard stop at max duration — fires once because the guard above caps the timer
          if (next >= maxDuration && !shownAlertsRef.current.has('stop')) {
            shownAlertsRef.current.add('stop');
            toast.error('Time limit reached — session ending', { duration: 3000 });
            setTimeout(() => {
              handleStopRecording();
            }, 2000);
          }

          return next;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, isPaused, maxDuration]);

  // Sample metrics every second for chunk uploads
  useEffect(() => {
    if (!isRecording || isPaused) return;

    const interval = setInterval(() => {
      // Sample WPM and volume
      wpmSamplesRef.current.push(audioMetrics.wpm);
      volumeSamplesRef.current.push(audioMetrics.volume);

      // Track filler word changes
      if (audioMetrics.fillerWords > lastFillerCountRef.current) {
        const newFillers = audioMetrics.fillerWords - lastFillerCountRef.current;
        for (let i = 0; i < newFillers; i++) {
          fillerWordsRef.current.push({
            word: 'filler', // Generic placeholder
            timestamp: Date.now()
          });
        }
        lastFillerCountRef.current = audioMetrics.fillerWords;
      }
    }, 1000); // Sample every second

    return () => clearInterval(interval);
  }, [isRecording, isPaused, audioMetrics]);

  // Analyze gaze from blendshapes
  const analyzeGaze = useCallback((shapes: { categories: { categoryName: string; score: number }[] }[]) => {
    if (!shapes || shapes.length === 0) return { isLookingAtScreen: false, direction: 'Unknown' };

    const categories = shapes[0].categories;
    const scores: Record<string, number> = {};
    
    categories.forEach((cat) => {
      scores[cat.categoryName] = cat.score;
    });

    const eyesWide = (scores.eyeWideLeft + scores.eyeWideRight) / 2;
    const isSurprised = eyesWide > 0.4;
    
    const { SURPRISE_MULTIPLIER } = ANALYSIS_CONFIG.GAZE_THRESHOLDS;
    const lookUpThreshold = isSurprised ? SURPRISE_MULTIPLIER.LOOK_UP : 0.3;

    const lookLeft = (scores.eyeLookInRight + scores.eyeLookOutLeft) / 2;
    const lookRight = (scores.eyeLookInLeft + scores.eyeLookOutRight) / 2;
    const lookUp = (scores.eyeLookUpLeft + scores.eyeLookUpRight) / 2;
    const lookDown = (scores.eyeLookDownLeft + scores.eyeLookDownRight) / 2;
    
    let isLookingAtScreen = true;
    let message = 'Good Eye Contact';
    let color = 'text-green-600';
    let direction = 'Center';

    const { GAZE_THRESHOLDS } = ANALYSIS_CONFIG;

    if (lookLeft > GAZE_THRESHOLDS.LOOK_LEFT) {
      isLookingAtScreen = false;
      message = 'Please maintain eye contact (Looking Left)';
      color = 'text-red-600';
      direction = 'Left';
    } else if (lookRight > GAZE_THRESHOLDS.LOOK_RIGHT) {
      isLookingAtScreen = false;
      message = 'Please maintain eye contact (Looking Right)';
      color = 'text-red-600';
      direction = 'Right';
    } else if (lookUp > lookUpThreshold) {
      isLookingAtScreen = false;
      message = 'Please maintain eye contact (Looking Up)';
      color = 'text-orange-600';
      direction = 'Up';
    } else if (lookDown > GAZE_THRESHOLDS.LOOK_DOWN) {
      isLookingAtScreen = false;
      message = 'Please maintain eye contact (Looking Down)';
      color = 'text-orange-600';
      direction = 'Down';
    }

    setGazeStatus({ isLookingAtScreen, message, color, direction });
    return { isLookingAtScreen, direction };
  }, []);

  // Process video frames loop
  const processFrame = useCallback(function loop(time: number) {
    if (!videoRef.current || !canvasRef.current || !cameraActive || mpStatus !== 'ready') {
      animationFrameRef.current = requestAnimationFrame(loop);
      return;
    }

    const delta = time - lastProcessTimeRef.current;
    if (delta < ANALYSIS_CONFIG.PERFORMANCE.FRAME_INTERVAL) {
      animationFrameRef.current = requestAnimationFrame(loop);
      return;
    }
    lastProcessTimeRef.current = time - (delta % ANALYSIS_CONFIG.PERFORMANCE.FRAME_INTERVAL);

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      animationFrameRef.current = requestAnimationFrame(loop);
      return;
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const result = detectForVideo(video, time);

    if (result) {
      const ctx = canvas.getContext('2d');
      if (isCalibrating && showMesh) {
        drawResults(canvas, result);
      } else {
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      
      if (result.faceBlendshapes && result.faceBlendshapes.length > 0) {
        const { isLookingAtScreen } = analyzeGaze(result.faceBlendshapes);

        // Audio Alert Logic + Gaze Event Tracking
        if (isRecording && !isPaused) {
          const now = Date.now();

          if (!isLookingAtScreen) {
            lookBackStartTimeRef.current = null;

            if (lookAwayStartTimeRef.current === null) {
              lookAwayStartTimeRef.current = now;
            }

            const durationLookingAway = now - lookAwayStartTimeRef.current;

            if (durationLookingAway > ANALYSIS_CONFIG.TIMING.LOOK_AWAY_THRESHOLD_MS && !alertPlayedRef.current) {
              playAlertSound();
              alertPlayedRef.current = true;

              // Track gaze event (sustained look away >3sec)
              gazeEventsRef.current.push({
                type: 'lookAway',
                timestamp: now,
                duration: durationLookingAway
              });
            }
          } else {
            // Looking back - record duration if we were looking away
            if (lookAwayStartTimeRef.current !== null) {
              const lookAwayDuration = now - lookAwayStartTimeRef.current;
              if (lookAwayDuration > ANALYSIS_CONFIG.TIMING.LOOK_AWAY_THRESHOLD_MS) {
                gazeEventsRef.current.push({
                  type: 'lookBack',
                  timestamp: now,
                  duration: lookAwayDuration
                });
              }
            }
            lookAwayStartTimeRef.current = null;

            if (lookBackStartTimeRef.current === null) {
              lookBackStartTimeRef.current = now;
            }

            if (now - lookBackStartTimeRef.current > ANALYSIS_CONFIG.TIMING.LOOK_BACK_THRESHOLD_MS) {
              alertPlayedRef.current = false;
            }
          }
        } else {
          lookAwayStartTimeRef.current = null;
          lookBackStartTimeRef.current = null;
          alertPlayedRef.current = false;
        }
      }
    }

    animationFrameRef.current = requestAnimationFrame(loop);
  }, [cameraActive, mpStatus, detectForVideo, drawResults, analyzeGaze, isCalibrating, showMesh, isRecording, isPaused, playAlertSound]);

  // Camera handling
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 640, height: 480 }, 
        audio: true 
      });
      
      mediaStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadeddata = () => {
          setCameraActive(true);
          setPermissionDenied(false);
          setIsCalibrating(true);
        };
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      setPermissionDenied(true);
    }
  };

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    mediaStreamRef.current = null;
    setCameraActive(false);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  // Start processing loop when camera and model are ready
  useEffect(() => {
    if (cameraActive && mpStatus === 'ready') {
      animationFrameRef.current = requestAnimationFrame(processFrame);
    }
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [cameraActive, mpStatus, processFrame]);

  // Chunk Upload Logic
  const uploadChunk = useCallback(async () => {
    try {
      const now = Date.now();
      const token = await getIdToken();

      // Prepare chunk data
      const chunk = {
        chunkIndex: chunkIndexRef.current,
        timestamp: now,
        wpmSamples: [...wpmSamplesRef.current],
        volumeSamples: [...volumeSamplesRef.current],
        fillerWords: [...fillerWordsRef.current],
        gazeEvents: [...gazeEventsRef.current],
        transcriptSegments: transcripts
          .filter(t => t.isFinal)
          .map(t => ({
            text: t.text,
            timestamp: t.timestamp,
            isFinal: t.isFinal
          }))
      };

      // Get multipart upload URL
      const uploadUrlResponse = await fetch(
        `${API_BASE_URL}/multipart_upload?sessionID=${sessionID}&chunkIndex=${chunk.chunkIndex}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (!uploadUrlResponse.ok) {
        throw new Error('Failed to get upload URL');
      }

      const { uploadUrl, fields } = await uploadUrlResponse.json();

      // Upload chunk to S3
      const formData = new FormData();
      Object.entries(fields).forEach(([key, value]) => {
        formData.append(key, value as string);
      });
      formData.append('file', new Blob([JSON.stringify(chunk)], { type: 'application/json' }));

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        body: formData
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload chunk');
      }

      console.log(`[INFO] Uploaded chunk ${chunk.chunkIndex}`);

      // Clear collected data and increment chunk index
      wpmSamplesRef.current = [];
      volumeSamplesRef.current = [];
      fillerWordsRef.current = [];
      gazeEventsRef.current = [];
      chunkIndexRef.current++;
      lastChunkTimeRef.current = now;
    } catch (error) {
      console.error('[ERROR] Failed to upload chunk:', error);
    }
  }, [sessionID, getIdToken, transcripts]);

  // Upload chunks every 15 seconds during recording
  useEffect(() => {
    if (!isRecording || isPaused) return;

    // Upload immediately on start if it's been 15+ seconds
    if (lastChunkTimeRef.current === 0) {
      lastChunkTimeRef.current = Date.now();
    }

    const interval = setInterval(() => {
      uploadChunk();
    }, DATA_CHUNK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isRecording, isPaused, uploadChunk]);

  // Recording Handlers
  const handleStartRecording = async () => {
    if (cameraActive && mediaStreamRef.current) {
      setIsCalibrating(false);
      setIsRecording(true);
      setIsPaused(false);
      lookAwayStartTimeRef.current = null;
      lookBackStartTimeRef.current = null;
      alertPlayedRef.current = false;

      // Start audio analysis (Transcribe + volume/filler/pause detection)
      await startAnalysis(mediaStreamRef.current);
    }
  };
  
  const handlePauseRecording = () => {
    setIsPaused(true);
    pauseAnalysis();
  };
  
  const handleResumeRecording = () => {
    setIsPaused(false);
    resumeAnalysis();
  };

  const handleStopRecording = async () => {
    setIsRecording(false);
    setIsPaused(false);
    stopAnalysis();

    try {
      // Upload final chunk if there's any collected data
      if (wpmSamplesRef.current.length > 0 || volumeSamplesRef.current.length > 0) {
        await uploadChunk();
      }

      // Trigger analytics pipeline
      const token = await getIdToken();
      const completeResponse = await fetch(
        `${API_BASE_URL}/sessions/${sessionID}/complete`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            personaID,
            totalDuration: timer
          })
        }
      );

      if (!completeResponse.ok) {
        throw new Error('Failed to trigger analytics');
      }

      console.log(`[INFO] Session ${sessionID} marked complete, analytics pipeline triggered`);
    } catch (error) {
      console.error('[ERROR] Failed to complete session:', error);
      toast.error('Failed to save session data');
    } finally {
      stopCamera();
      onComplete(sessionID);
    }
  };

  // Map audio metrics to the shape RealTimeFeedbackPanel expects
  const feedbackMetrics = {
    speakingPace: audioMetrics.wpm,
    volumeLevel: audioMetrics.volume,
    fillerWords: audioMetrics.fillerWords,
    pauses: audioMetrics.pauses,
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-3 sm:px-6 sm:py-4 2xl:max-w-[1600px] 2xl:py-8">
      {/* 1. Header Section */}
      <PracticeSessionHeader 
        onBack={onBack}
        timer={timer}
        maxDurationSec={maxDuration}
        personaTitle={personaTitle}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 2xl:gap-6">
        {/* 2. Left Column: Camera View & Controls */}
        <div className="lg:col-span-2 space-y-3">
          <CameraView 
            videoRef={videoRef}
            canvasRef={canvasRef}
            cameraActive={cameraActive}
            isRecording={isRecording}
            isPaused={isPaused}
            isCalibrating={isCalibrating}
            permissionDenied={permissionDenied}
            onStartCamera={startCamera}
            onStartRecording={handleStartRecording}
            onPauseRecording={handlePauseRecording}
            onResumeRecording={handleResumeRecording}
            onStopRecording={handleStopRecording}
            onReEnterCalibration={() => setIsCalibrating(true)}
          />
        </div>

        {/* 3. Right Column: Dynamic Panel (Feedback OR Calibration) */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm 2xl:p-6 relative overflow-hidden">
            
            {isCalibrating ? (
              <CalibrationPanel 
                showMesh={showMesh}
                onToggleMesh={() => setShowMesh(!showMesh)}
                gazeStatus={gazeStatus}
                onComplete={() => setIsCalibrating(false)}
              />
            ) : (
              <RealTimeFeedbackPanel 
                isRecording={isRecording && !isPaused}
                soundEnabled={soundEnabled}
                onToggleSound={() => setSoundEnabled(!soundEnabled)}
                gazeStatus={gazeStatus}
                metrics={feedbackMetrics}
              />
            )}
          </div>
        </div>
      </div>

      {/* 4. Live Transcription — hidden during calibration */}
      {!isCalibrating && (
        <TranscriptionPanel
          transcripts={transcripts}
          partialTranscript={partialTranscript}
          isRecording={isRecording && !isPaused}
          isTranscribing={isTranscribing && isRecording && !isPaused}
        />
      )}

    </div>
  );
}
