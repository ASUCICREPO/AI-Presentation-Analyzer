'use client';

import React, { useState, useRef, useEffect, useCallback, MutableRefObject } from 'react';
import { useFaceLandmarker } from '../hooks/useFaceLandmarker';
import { useAudioAnalysis } from '../hooks/useAudioAnalysis';
import { useVocalVariety } from '../hooks/useVocalVariety';
import { useSessionAnalytics, SessionAnalytics } from '../hooks/useSessionAnalytics';
import { useVideoRecording } from '../hooks/useVideoRecording';
import { useDetailedMetrics } from '../hooks/useDetailedMetrics';
import { useSessionManifest } from '../hooks/useSessionManifest';
import { useMicCalibration } from '../hooks/useMicCalibration';
import { uploadJsonToS3, pollAnalytics, AIFeedbackResponse } from '../services/api';
import { ANALYSIS_CONFIG, PRESENTATION_LIMITS, DEFAULT_TIME_LIMIT_SEC } from '../config/config';

import { toast } from 'sonner';

// Import modular components
import PracticeSessionHeader from './practice/PracticeSessionHeader';
import CameraView from './practice/CameraView';
import CalibrationPanel from './practice/CalibrationPanel';
import MicCheckCard from './practice/MicCheckCard';
import RealTimeFeedbackPanel from './practice/RealTimeFeedbackPanel';
import TranscriptionPanel from './practice/TranscriptionPanel';

// ─── Processing phase labels ──────────────────────────────────────────

interface PracticeSessionProps {
  personaTitle: string;
  personaId: string;
  sessionId: string;
  timeLimitSec?: number;
  hasPresentationPdf?: boolean;
  hasPersonaCustomization?: boolean;
  onBack: () => void;
  onComplete: (sessionData: SessionAnalytics, analyticsPromise: Promise<AIFeedbackResponse | null>) => void;
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
  const [calibrationStep, setCalibrationStep] = useState<1 | 2>(1);
  const [showMesh, setShowMesh] = useState(false);

  // Runtime toggle for real-time feedback panel (config provides default)
  const [showFeedback, setShowFeedback] = useState(ANALYSIS_CONFIG.SHOW_REALTIME_FEEDBACK);

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
  const stoppingRef = useRef(false);

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

  // Mic Calibration Hook (lightweight volume meter for pre-session check)
  const micCalibration = useMicCalibration();

  // Register exit handler so parent can cleanly stop the session on exit
  useEffect(() => {
    if (exitSessionRef) {
      exitSessionRef.current = () => {
        stopAnalysis();
        vocalVariety.stopAnalysis();
        micCalibration.stop();
        if (!stoppingRef.current) {
          videoRecording.abort();
        }
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
    const lookUpThreshold = isSurprised ? SURPRISE_MULTIPLIER.LOOK_UP : ANALYSIS_CONFIG.GAZE_THRESHOLDS.LOOK_UP;

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
            // User is looking away — reset the "looking back" debounce
            // but keep the look-away timer running.
            lookBackStartTimeRef.current = null;

            if (lookAwayStartTimeRef.current === null) {
              lookAwayStartTimeRef.current = now;
            }

            const durationLookingAway = now - lookAwayStartTimeRef.current;

            if (durationLookingAway > ANALYSIS_CONFIG.TIMING.LOOK_AWAY_THRESHOLD_MS) {
              setGazeDisplayDistracted(true);

              if (!alertPlayedRef.current) {
                playAlertSound();
                alertPlayedRef.current = true;
              }
            }
          } else {
            // User appears to be looking at camera — but don't reset
            // the look-away timer until sustained gaze is confirmed,
            // otherwise single-frame noise kills the accumulation.
            if (lookBackStartTimeRef.current === null) {
              lookBackStartTimeRef.current = now;
            }

            if (now - lookBackStartTimeRef.current > ANALYSIS_CONFIG.TIMING.LOOK_BACK_THRESHOLD_MS) {
              lookAwayStartTimeRef.current = null;
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
          setIsCalibrating(true);
          // Start mic calibration as soon as camera/mic stream is ready
          micCalibration.start(stream);
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
  // video recording, mic calibration, and aborts manifest so no media streams leak.
  useEffect(() => {
    return () => {
      stopAnalysis();
      vocalVariety.stopAnalysis();
      micCalibration.stop();
      if (!stoppingRef.current) {
        videoRecording.abort();
      }
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
      micCalibration.stop();
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
    stoppingRef.current = true;
    setIsRecording(false);
    setIsPaused(false);
    stopAnalysis();
    vocalVariety.stopAnalysis();

    sessionAnalytics.finalizeWindow();
    const sessionData = sessionAnalytics.getSessionData();

    // Fire-and-forget video upload
    videoRecording.stop().catch((err) => {
      console.error('[PracticeSession] Error stopping video recording:', err);
      toast.error('Failed to save video recording');
    });

    // Upload JSON files in background with toast notifications
    const uploadPromises: Promise<void>[] = [];

    uploadPromises.push(
      uploadJsonToS3('session_analytics', sessionId, sessionData).catch((err) => {
        console.error('[PracticeSession] Failed to upload session analytics:', err);
        toast.error('Failed to upload session analytics');
      }),
    );

    if (transcripts.length > 0) {
      uploadPromises.push(
        uploadJsonToS3('transcript', sessionId, {
          sessionId,
          transcripts,
        }).catch((err) => {
          console.error('[PracticeSession] Failed to upload transcript:', err);
          toast.error('Failed to upload transcript');
        }),
      );
    }

    const detailedData = detailedMetrics.getData();
    if (detailedData.snapshots.length > 0) {
      uploadPromises.push(
        uploadJsonToS3('detailed_metrics', sessionId, detailedData).catch((err) => {
          console.error('[PracticeSession] Failed to upload detailed metrics:', err);
          toast.error('Failed to upload detailed metrics');
        }),
      );
    }

    // Complete manifest after uploads, then kick off AI analytics — all in background
    const analyticsPromise: Promise<AIFeedbackResponse | null> = (async () => {
      await Promise.allSettled(uploadPromises);
      await manifest.complete(timer);
      toast.info('Analyzing your presentation...', { duration: 4000 });

      try {
        return await pollAnalytics(sessionId);
      } catch (err) {
        console.error('[PracticeSession] AI analytics failed:', err);
        toast.error('AI analysis encountered an issue — results may be incomplete');
        return null;
      }
    })();

    stopCamera();
    onComplete(sessionData, analyticsPromise);
  };

  // Map audio metrics to the shape RealTimeFeedbackPanel expects
  const feedbackMetrics = {
    speakingPace: audioMetrics.wpm,
    volumeLevel: audioMetrics.volume,
    fillerWords: audioMetrics.fillerWords,
    pauses: audioMetrics.pauses,
  };

  const showRightPanel = showFeedback || isCalibrating;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-3 sm:px-6 sm:py-4 2xl:max-w-[1600px] 2xl:py-8">
      {/* 1. Header Section */}
      <PracticeSessionHeader
        onBack={onBack}
        timer={timer}
        maxDurationSec={maxDuration}
        personaTitle={personaTitle}
        showFeedback={showFeedback}
        onToggleFeedback={() => setShowFeedback((prev) => !prev)}
      />

      <div className="flex flex-col lg:flex-row gap-4 2xl:gap-6">
        {/* 2. Left Column: Camera View & Controls */}
        <div
          className="space-y-3 min-w-0"
          style={{ flex: '2 1 0%' }}
        >
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
            onReEnterCalibration={() => { setCalibrationStep(1); setIsCalibrating(true); }}
          />
        </div>

        {/* 3. Right Column: Calibration always here, Feedback only when toggled on */}
        <div
          className="space-y-4 min-w-0 overflow-hidden"
          style={{
            flex: showRightPanel ? '1 1 0%' : '0 0 0px',
            opacity: showRightPanel ? 1 : 0,
            transition: 'flex 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease',
          }}
        >
          {showRightPanel && (
            <>
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm 2xl:p-8 relative overflow-hidden animate-fade-in">
                {isCalibrating ? (
                  calibrationStep === 1 ? (
                    <CalibrationPanel
                      showMesh={showMesh}
                      onToggleMesh={() => setShowMesh(!showMesh)}
                      gazeStatus={gazeStatus}
                    />
                  ) : (
                    <MicCheckCard micCalibration={micCalibration} onBack={() => setCalibrationStep(1)} />
                  )
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
              {isCalibrating && calibrationStep === 1 && (
                <button
                  onClick={() => setCalibrationStep(2)}
                  className="w-full rounded-lg bg-maroon px-4 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-maroon-dark hover:shadow-xl transform active:scale-[0.98] transition-all flex items-center justify-center gap-2 font-sans animate-fade-in"
                >
                  <span>Continue to Mic Calibration</span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </button>
              )}
              {isCalibrating && calibrationStep === 2 && (
                <button
                  onClick={() => setIsCalibrating(false)}
                  className="w-full rounded-lg bg-maroon px-4 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-maroon-dark hover:shadow-xl transform active:scale-[0.98] transition-all flex items-center justify-center gap-2 font-sans animate-fade-in"
                >
                  <span>Everything Looks Good</span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
              )}
            </>
          )}
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
