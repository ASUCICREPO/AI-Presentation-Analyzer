'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ACADEMIC_PERSONA } from '../config/personas';
import { useFaceLandmarker } from '../hooks/useFaceLandmarker';
import { ANALYSIS_CONFIG } from '../config/analysisConfig';

// Import modular components
import PracticeSessionHeader from './practice/PracticeSessionHeader';
import CameraView from './practice/CameraView';
import CalibrationPanel from './practice/CalibrationPanel';
import RealTimeFeedbackPanel from './practice/RealTimeFeedbackPanel';
import FeedbackLog from './practice/FeedbackLog';

interface PracticeSessionProps {
  onBack: () => void;
  onComplete: () => void;
}

interface FeedbackEvent {
  time: string;
  message: string;
  type: 'warning' | 'info' | 'success';
}

export default function PracticeSession({ onBack, onComplete }: PracticeSessionProps) {
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
  
  // Audio Feedback State
  const [soundEnabled, setSoundEnabled] = useState(true);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Eye Contact Logic Refs
  const lookAwayStartTimeRef = useRef<number | null>(null);
  const lookBackStartTimeRef = useRef<number | null>(null);
  const alertPlayedRef = useRef(false);

  // New Calibration Mode State
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [showMesh, setShowMesh] = useState(true); // Toggle for mesh visibility
  
  // Feedback State
  const [gazeStatus, setGazeStatus] = useState({
    isLookingAtScreen: true,
    message: 'Good Eye Contact',
    color: 'text-green-600',
    direction: 'Center'
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

  // Initialize Audio Context
  useEffect(() => {
    if (typeof window !== 'undefined') {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  const playAlertSound = useCallback(() => {
    if (!audioContextRef.current || !soundEnabled) return;
    
    // Resume context if suspended (browser policy)
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
  const analyzeGaze = useCallback((shapes: any[]) => {
    if (!shapes || shapes.length === 0) return { isLookingAtScreen: false, direction: 'Unknown' };

    const categories = shapes[0].categories;
    const scores: Record<string, number> = {};
    
    categories.forEach((cat: any) => {
      scores[cat.categoryName] = cat.score;
    });

    // Check gaze directions
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

    // Limit FPS
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

    // Match canvas to video dimensions
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const result = detectForVideo(video, time);

    if (result) {
      const ctx = canvas.getContext('2d');
      // Only draw mesh if in calibration mode AND mesh is enabled
      if (isCalibrating && showMesh) {
        drawResults(canvas, result);
      } else {
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      
      if (result.faceBlendshapes && result.faceBlendshapes.length > 0) {
        const { isLookingAtScreen } = analyzeGaze(result.faceBlendshapes);

        // --- Audio Alert Logic ---
        if (isRecording && !isPaused) {
          const now = Date.now();

          if (!isLookingAtScreen) {
            // User is looking away
            lookBackStartTimeRef.current = null; // Reset look-back timer

            if (lookAwayStartTimeRef.current === null) {
              lookAwayStartTimeRef.current = now; // Start look-away timer
            }

            const durationLookingAway = now - lookAwayStartTimeRef.current;

            // Trigger alert if threshold exceeded and not already played
            if (durationLookingAway > ANALYSIS_CONFIG.TIMING.LOOK_AWAY_THRESHOLD_MS && !alertPlayedRef.current) {
              playAlertSound();
              alertPlayedRef.current = true; // Mark as played so it only happens once per "distraction"
            }
          } else {
            // User is looking at screen (Center)
            lookAwayStartTimeRef.current = null; // Reset look-away timer

            if (lookBackStartTimeRef.current === null) {
              lookBackStartTimeRef.current = now;
            }

            // Check if they have held gaze for the recovery threshold
            if (now - lookBackStartTimeRef.current > ANALYSIS_CONFIG.TIMING.LOOK_BACK_THRESHOLD_MS) {
              alertPlayedRef.current = false; // Reset alert state, ready for next distraction
            }
          }
        } else {
          // Reset all logic when paused/stopped
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
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Wait for video to be ready before setting active
        videoRef.current.onloadeddata = () => {
          setCameraActive(true);
          setPermissionDenied(false);
          setIsCalibrating(true); // Automatically enter calibration mode on start
          setShowMesh(true); // Reset mesh to visible on start
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
    setCameraActive(false);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  // Removed auto-start useEffect. Only cleanup on unmount.
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
  const handleStartRecording = () => {
    if (cameraActive) {
      setIsCalibrating(false); // Ensure mesh is off when recording starts
      setIsRecording(true);
      setIsPaused(false);
      // Reset logic states
      lookAwayStartTimeRef.current = null;
      lookBackStartTimeRef.current = null;
      alertPlayedRef.current = false;
    }
  };
  
  const handlePauseRecording = () => {
    setIsPaused(true);
  };
  
  const handleResumeRecording = () => {
    setIsPaused(false);
  };

  const handleStopRecording = () => {
    setIsRecording(false);
    setIsPaused(false);
    stopCamera();
    onComplete();
  };

  // Mock feedback for demonstration
  const feedbackMetrics = {
    speakingPace: 131,
    volumeLevel: 71,
    fillerWords: 5,
    pauses: 10,
  };

  const feedbackEvents: FeedbackEvent[] = [
    { time: '00:23', message: 'Looking away from camera for extended period', type: 'warning' },
    { time: '00:19', message: 'Volume too low - speak up for clarity', type: 'info' },
    { time: '00:18', message: 'Filler word detected: "like"', type: 'warning' },
    { time: '00:17', message: 'Good eye contact - keep it up!', type: 'success' },
  ];
  
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 2xl:max-w-[1600px] 2xl:py-12">
      {/* 1. Header Section */}
      <PracticeSessionHeader 
        onBack={onBack}
        timer={timer}
        personaTitle={ACADEMIC_PERSONA.title}
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
                isRecording={isRecording}
                soundEnabled={soundEnabled}
                onToggleSound={() => setSoundEnabled(!soundEnabled)}
                gazeStatus={gazeStatus}
                metrics={feedbackMetrics}
              />
            )}
          </div>
        </div>
      </div>

      {/* 4. Timestamped Feedback Scroll */}
      {isRecording && (
        <FeedbackLog events={feedbackEvents} />
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
