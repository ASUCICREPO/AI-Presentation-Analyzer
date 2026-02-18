'use client';

import React, { useState, useRef, useEffect, useCallback, MutableRefObject } from 'react';
import { useFaceLandmarker } from '../hooks/useFaceLandmarker';
import { useAudioAnalysis } from '../hooks/useAudioAnalysis';
import { useVocalVariety } from '../hooks/useVocalVariety';
import { useSessionAnalytics, SessionAnalytics } from '../hooks/useSessionAnalytics';
import { useVideoRecording } from '../hooks/useVideoRecording';
import { useDetailedMetrics } from '../hooks/useDetailedMetrics';
import { useSessionManifest } from '../hooks/useSessionManifest';
import { uploadJsonToS3, pollAnalytics, AIFeedbackResponse } from '../services/api';
import { ANALYSIS_CONFIG, PRESENTATION_LIMITS, DEFAULT_TIME_LIMIT_SEC } from '../config/config';

import { toast } from 'sonner';

// Import modular components
import PracticeSessionHeader from './practice/PracticeSessionHeader';
import CameraView from './practice/CameraView';
import CalibrationPanel from './practice/CalibrationPanel';
import RealTimeFeedbackPanel from './practice/RealTimeFeedbackPanel';
import TranscriptionPanel from './practice/TranscriptionPanel';

// ─── Processing phase labels ──────────────────────────────────────────
const PROCESSING_PHASES = [
  'Uploading your session...',
  'Analyzing your presentation...',
  'Almost there...',
] as const;

type ProcessingPhase = 0 | 1 | 2;

interface PracticeSessionProps {
  personaTitle: string;
  personaId: string;
  sessionId: string;
  timeLimitSec?: number;
  hasPresentationPdf?: boolean;
  hasPersonaCustomization?: boolean;
  onBack: () => void;
  onComplete: (sessionData: SessionAnalytics, aiFeedback: AIFeedbackResponse | null) => void;
  exitSessionRef?: MutableRefObject<(() => void) | null>;
}

export default function PracticeSession({ personaTitle, personaId, sessionId, timeLimitSec, hasPresentationPdf, hasPersonaCustomization, onBack, onComplete, exitSessionRef }: PracticeSessionProps) {
  // Resolve the effective time cap for this session
  const maxDuration = timeLimitSec ?? DEFAULT_TIME_LIMIT_SEC;
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [timer, setTimer] = useState(0);
  const [cameraActive, setCameraActive] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingPhase, setProcessingPhase] = useState<ProcessingPhase>(0);

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
  // Debounced "distracted" flag — only true after looking away for 3+ seconds
  const [gazeDisplayDistracted, setGazeDisplayDistracted] = useState(false);

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

  // Vocal Variety Hook
  const vocalVariety = useVocalVariety();

  // Session Analytics Hook
  const sessionAnalytics = useSessionAnalytics(personaTitle, sessionId);
  const analyticsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const windowIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isPausedRef = useRef(false);

  // Session Manifest Hook (lightweight coordination file in S3)
  const manifest = useSessionManifest(sessionId, personaId);

  // Video Recording Hook (multipart upload) — updates manifest after each chunk
  const videoRecording = useVideoRecording(sessionId, {
    onPartUploaded: (partsUploaded) => {
      manifest.update({ videoParts: partsUploaded });
    },
  });

  // Detailed Metrics Hook (per-second snapshots)
  const detailedMetrics = useDetailedMetrics(sessionId);

  // Register exit handler so parent can cleanly stop the session on exit
  useEffect(() => {
    if (exitSessionRef) {
      exitSessionRef.current = () => {
        stopAnalysis();
        vocalVariety.stopAnalysis();
        videoRecording.abort();
        manifest.abort(timer);
        stopCamera();
      };
    }
    return () => {
      if (exitSessionRef) exitSessionRef.current = null;
    };
  });

  // Refs to store latest metric values
  const latestMetricsRef = useRef({
    wpm: 0,
    volume: 0,
    isLookingAtScreen: true,
    fillerWords: 0,
    pauses: 0,
    direction: 'Center' as string,
  });

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

  // Update latest metrics ref whenever they change
  useEffect(() => {
    latestMetricsRef.current = {
      wpm: audioMetrics.wpm,
      volume: audioMetrics.volume,
      isLookingAtScreen: gazeStatus.isLookingAtScreen,
      fillerWords: audioMetrics.fillerWords,
      pauses: audioMetrics.pauses,
      direction: gazeStatus.direction,
    };
  }, [audioMetrics.wpm, audioMetrics.volume, audioMetrics.fillerWords, audioMetrics.pauses, gazeStatus.isLookingAtScreen, gazeStatus.direction]);

  // Collect metrics every second when recording
  useEffect(() => {
    if (!isRecording || isPaused) {
      if (analyticsIntervalRef.current) {
        clearInterval(analyticsIntervalRef.current);
        analyticsIntervalRef.current = null;
      }
      return;
    }

    analyticsIntervalRef.current = setInterval(() => {
      sessionAnalytics.updateMetrics(latestMetricsRef.current);

      // Also feed per-second detailed metrics
      detailedMetrics.record({
        wpm: latestMetricsRef.current.wpm,
        vol: latestMetricsRef.current.volume,
        gaze: latestMetricsRef.current.isLookingAtScreen,
        fillers: latestMetricsRef.current.fillerWords,
        pauses: latestMetricsRef.current.pauses,
        direction: latestMetricsRef.current.direction,
      });
    }, 1000);

    return () => {
      if (analyticsIntervalRef.current) {
        clearInterval(analyticsIntervalRef.current);
        analyticsIntervalRef.current = null;
      }
    };
  }, [isRecording, isPaused]);

  // Finalize 30-second windows
  useEffect(() => {
    if (!isRecording || isPaused) {
      if (windowIntervalRef.current) {
        clearInterval(windowIntervalRef.current);
        windowIntervalRef.current = null;
      }
      return;
    }

    windowIntervalRef.current = setInterval(() => {
      sessionAnalytics.finalizeWindow();
    }, 30000);

    return () => {
      if (windowIntervalRef.current) {
        clearInterval(windowIntervalRef.current);
        windowIntervalRef.current = null;
      }
    };
  }, [isRecording, isPaused]);

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

        // Audio Alert & Debounced Display Logic
        if (isRecording && !isPaused) {
          const now = Date.now();

          if (!isLookingAtScreen) {
            lookBackStartTimeRef.current = null;

            if (lookAwayStartTimeRef.current === null) {
              lookAwayStartTimeRef.current = now;
            }

            const durationLookingAway = now - lookAwayStartTimeRef.current;

            if (durationLookingAway > ANALYSIS_CONFIG.TIMING.LOOK_AWAY_THRESHOLD_MS) {
              // Show "distracted" in the UI after the threshold
              setGazeDisplayDistracted(true);

              if (!alertPlayedRef.current) {
                playAlertSound();
                alertPlayedRef.current = true;
              }
            }
          } else {
            lookAwayStartTimeRef.current = null;

            if (lookBackStartTimeRef.current === null) {
              lookBackStartTimeRef.current = now;
            }

            if (now - lookBackStartTimeRef.current > ANALYSIS_CONFIG.TIMING.LOOK_BACK_THRESHOLD_MS) {
              alertPlayedRef.current = false;
              setGazeDisplayDistracted(false);
            }
          }
        } else {
          lookAwayStartTimeRef.current = null;
          lookBackStartTimeRef.current = null;
          alertPlayedRef.current = false;
          setGazeDisplayDistracted(false);
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
          setIsCalibrating(ANALYSIS_CONFIG.SHOW_REALTIME_FEEDBACK);
        };
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      setPermissionDenied(true);
    }
  };

  const stopCamera = useCallback(() => {
    // Stop all tracks via the ref (survives React unmount)
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    // Also clear the video element's srcObject
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  // Full cleanup on unmount — stops camera, audio analysis, vocal variety,
  // video recording, and aborts manifest so no media streams leak.
  useEffect(() => {
    return () => {
      stopAnalysis();
      vocalVariety.stopAnalysis();
      videoRecording.abort();
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const currentStream = mediaStreamRef.current;

      setIsCalibrating(false);
      setIsRecording(true);
      setIsPaused(false);
      isPausedRef.current = false;
      lookAwayStartTimeRef.current = null;
      lookBackStartTimeRef.current = null;
      alertPlayedRef.current = false;

      // Reset session analytics
      sessionAnalytics.resetSession();

      // Reset detailed metrics
      detailedMetrics.reset();

      // Create session manifest in S3
      manifest.create({
        hasPresentationPdf: hasPresentationPdf ?? false,
        hasPersonaCustomization: hasPersonaCustomization ?? false,
      });

      // Start both audio analysis and vocal variety in parallel
      try {
        await Promise.all([
          startAnalysis(currentStream),
          vocalVariety.startAnalysis(currentStream),
          videoRecording.start(currentStream),
        ]);
      } catch (error) {
        console.error('[PracticeSession] Error starting analyses:', error);
      }

      // Metrics collection handled by useEffect
    }
  };

  const handlePauseRecording = () => {
    setIsPaused(true);
    isPausedRef.current = true;
    pauseAnalysis();
    videoRecording.pause();
  };

  const handleResumeRecording = () => {
    setIsPaused(false);
    isPausedRef.current = false;
    resumeAnalysis();
    videoRecording.resume();
  };

  const handleStopRecording = async () => {
    setIsRecording(false);
    setIsPaused(false);
    setIsProcessing(true);
    setProcessingPhase(0);
    stopAnalysis();
    vocalVariety.stopAnalysis();

    sessionAnalytics.finalizeWindow();
    const sessionData = sessionAnalytics.getSessionData();

    // Fire-and-forget video upload — analytics don't depend on video
    videoRecording.stop().catch((err) =>
      console.error('[PracticeSession] Error stopping video recording:', err),
    );

    // Upload required JSON files in parallel
    const uploadPromises: Promise<void>[] = [];

    uploadPromises.push(
      uploadJsonToS3('session_analytics', sessionId, sessionData).catch((err) =>
        console.error('[PracticeSession] Failed to upload session analytics:', err),
      ),
    );

    if (transcripts.length > 0) {
      uploadPromises.push(
        uploadJsonToS3('transcript', sessionId, {
          sessionId,
          transcripts,
        }).catch((err) =>
          console.error('[PracticeSession] Failed to upload transcript:', err),
        ),
      );
    }

    const detailedData = detailedMetrics.getData();
    if (detailedData.snapshots.length > 0) {
      uploadPromises.push(
        uploadJsonToS3('detailed_metrics', sessionId, detailedData).catch((err) =>
          console.error('[PracticeSession] Failed to upload detailed metrics:', err),
        ),
      );
    }

    await Promise.allSettled(uploadPromises);
    await manifest.complete(timer);

    // Kick off AI analytics
    setProcessingPhase(1);

    const almostThereTimer = setTimeout(() => setProcessingPhase(2), 15_000);

    let aiFeedback: AIFeedbackResponse | null = null;
    try {
      aiFeedback = await pollAnalytics(sessionId);
    } catch (err) {
      console.error('[PracticeSession] AI analytics failed:', err);
    } finally {
      clearTimeout(almostThereTimer);
    }

    stopCamera();
    setIsProcessing(false);
    onComplete(sessionData, aiFeedback);
  };

  // Map audio metrics to the shape RealTimeFeedbackPanel expects
  const feedbackMetrics = {
    speakingPace: audioMetrics.wpm,
    volumeLevel: audioMetrics.volume,
    fillerWords: audioMetrics.fillerWords,
    pauses: audioMetrics.pauses,
  };

  // ─── Processing Screen ─────────────────────────────────────────────
  if (isProcessing) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4">
        <div className="mx-auto max-w-md text-center">
          {/* Animated rings */}
          <div className="relative mx-auto mb-8 h-24 w-24">
            <div className="absolute inset-0 animate-ping rounded-full bg-maroon-200 opacity-20" />
            <div className="absolute inset-2 animate-pulse rounded-full bg-maroon-100 opacity-40" />
            <div className="absolute inset-0 flex items-center justify-center">
              <svg
                className="h-12 w-12 animate-spin text-maroon-600"
                viewBox="0 0 48 48"
                fill="none"
              >
                <circle
                  cx="24"
                  cy="24"
                  r="20"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray="80 40"
                  opacity="0.3"
                />
                <circle
                  cx="24"
                  cy="24"
                  r="20"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray="30 90"
                />
              </svg>
            </div>
          </div>

          <h2 className="text-xl font-bold text-gray-900 font-serif italic sm:text-2xl 2xl:text-3xl">
            Processing Your Session
          </h2>
          <div className="relative mt-3 h-8 overflow-hidden">
            <p
              key={processingPhase}
              className="animate-fade-in text-sm text-gray-500 font-sans leading-relaxed sm:text-base 2xl:text-lg"
            >
              {PROCESSING_PHASES[processingPhase]}
            </p>
          </div>

          <p className="mt-8 text-xs text-gray-400 font-sans 2xl:text-sm">
            Please don&apos;t close this tab while processing.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-3 sm:px-6 sm:py-4 2xl:max-w-[1600px] 2xl:py-8">
      {/* 1. Header Section */}
      <PracticeSessionHeader
        onBack={onBack}
        timer={timer}
        maxDurationSec={maxDuration}
        personaTitle={personaTitle}
      />

      <div className={`grid grid-cols-1 gap-4 ${ANALYSIS_CONFIG.SHOW_REALTIME_FEEDBACK ? 'lg:grid-cols-3' : ''} 2xl:gap-6`}>
        {/* 2. Left Column: Camera View & Controls */}
        <div className={`${ANALYSIS_CONFIG.SHOW_REALTIME_FEEDBACK ? 'lg:col-span-2' : ''} space-y-3`}>
          <CameraView
            videoRef={videoRef}
            canvasRef={canvasRef}
            cameraActive={cameraActive}
            isRecording={isRecording}
            isPaused={isPaused}
            isCalibrating={isCalibrating}
            permissionDenied={permissionDenied}
            showCalibrationControls={ANALYSIS_CONFIG.SHOW_REALTIME_FEEDBACK}
            onStartCamera={startCamera}
            onStartRecording={handleStartRecording}
            onPauseRecording={handlePauseRecording}
            onResumeRecording={handleResumeRecording}
            onStopRecording={handleStopRecording}
            onReEnterCalibration={() => setIsCalibrating(true)}
          />
        </div>

        {/* 3. Right Column: Dynamic Panel (Feedback OR Calibration) */}
        {ANALYSIS_CONFIG.SHOW_REALTIME_FEEDBACK && (
        <div className="lg:col-span-1 space-y-4">
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
                isDistracted={gazeDisplayDistracted}
                metrics={feedbackMetrics}
                vocalVariety={vocalVariety.metrics}
              />
            )}
          </div>

        </div>
        )}
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
