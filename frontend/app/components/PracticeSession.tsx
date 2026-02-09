'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useFaceLandmarker } from '../hooks/useFaceLandmarker';
import { useAudioAnalysis } from '../hooks/useAudioAnalysis';
import { ANALYSIS_CONFIG } from '../config/config';

// Import modular components
import PracticeSessionHeader from './practice/PracticeSessionHeader';
import CameraView from './practice/CameraView';
import CalibrationPanel from './practice/CalibrationPanel';
import RealTimeFeedbackPanel from './practice/RealTimeFeedbackPanel';
import TranscriptionPanel from './practice/TranscriptionPanel';

interface PracticeSessionProps {
  personaTitle: string;
  onBack: () => void;
  onComplete: () => void;
}

export default function PracticeSession({ personaTitle, onBack, onComplete }: PracticeSessionProps) {
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

  // New Calibration Mode State
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [showMesh, setShowMesh] = useState(true);
  
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

  // Timer logic
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording && !isPaused) {
      interval = setInterval(() => {
        setTimer((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRecording, isPaused]);

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

        // Audio Alert Logic
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
            }
          } else {
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
          setShowMesh(true);
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

  const handleStopRecording = () => {
    setIsRecording(false);
    setIsPaused(false);
    stopAnalysis();
    stopCamera();
    onComplete();
  };

  // Map audio metrics to the shape RealTimeFeedbackPanel expects
  const feedbackMetrics = {
    speakingPace: audioMetrics.wpm,
    volumeLevel: audioMetrics.volume,
    fillerWords: audioMetrics.fillerWords,
    pauses: audioMetrics.pauses,
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 2xl:max-w-[1600px] 2xl:py-12">
      {/* 1. Header Section */}
      <PracticeSessionHeader 
        onBack={onBack}
        timer={timer}
        personaTitle={personaTitle}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 2xl:gap-10">
        {/* 2. Left Column: Camera View & Controls */}
        <div className="lg:col-span-2 space-y-6">
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
          <div className="h-full rounded-xl border border-gray-200 bg-white p-6 shadow-sm 2xl:p-8 relative overflow-hidden">
            
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

      {/* 4. Live Transcription (replaces Timestamped Feedback) */}
      {(isRecording || transcripts.length > 0) && (
        <TranscriptionPanel
          transcripts={transcripts}
          partialTranscript={partialTranscript}
          isRecording={isRecording && !isPaused}
          isTranscribing={isTranscribing}
        />
      )}

      {/* 5. Footer Navigation */}
      <div className="mt-8 flex justify-between border-t border-gray-100 pt-6 2xl:mt-12 2xl:pt-8">
        <button
          onClick={onBack}
          className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors 2xl:px-8 2xl:py-3.5 2xl:text-lg"
        >
          Exit Session
        </button>
      </div>
    </div>
  );
}
