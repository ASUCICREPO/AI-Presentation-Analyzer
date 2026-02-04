'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ACADEMIC_PERSONA } from '../config/personas';
import { useFaceLandmarker } from '../hooks/useFaceLandmarker';
import { FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import { 
  Sun, 
  Ruler, 
  ScanFace, 
  CheckCircle2, 
  Check,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  AlertCircle,
  Eye,
  Mic,
  Volume2,
  X,
  LogOut
} from 'lucide-react';

interface PracticeSessionProps {
  onBack: () => void;
  onComplete: () => void;
}

interface FeedbackEvent {
  time: string;
  message: string;
  type: 'warning' | 'info' | 'success';
}

// Blendshape thresholds for gaze detection
const GAZE_THRESHOLDS = {
  LOOK_LEFT: 0.5,
  LOOK_RIGHT: 0.5,
  LOOK_UP: 0.3, 
  LOOK_DOWN: 0.5,
};

const ALERT_COOLDOWN_MS = 2000;
const GRACE_PERIOD_MS = 3000; // 3 seconds grace period
const FPS_LIMIT = 30;
const FRAME_INTERVAL = 1000 / FPS_LIMIT;

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
  
  // Eye Contact Tracking Refs
  const eyeContactScoreRef = useRef(100);
  const totalSessionTimeRef = useRef(0);
  const focusedTimeRef = useRef(0);
  const lookAwayStartTimeRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  
  // Metrics State
  const [realTimeEyeContact, setRealTimeEyeContact] = useState(100);
  const [faceCount, setFaceCount] = useState(0);
  
  // New Calibration Mode State
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [showMesh, setShowMesh] = useState(true); // Toggle for mesh visibility
  
  const [blendShapes, setBlendShapes] = useState<any[]>([]);
  
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

  // Format time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

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
    
    const currentThreshold = isSurprised ? 0.7 : 0.5;
    const lookUpThreshold = isSurprised ? 0.6 : 0.3;

    const lookLeft = (scores.eyeLookInRight + scores.eyeLookOutLeft) / 2;
    const lookRight = (scores.eyeLookInLeft + scores.eyeLookOutRight) / 2;
    const lookUp = (scores.eyeLookUpLeft + scores.eyeLookUpRight) / 2;
    const lookDown = (scores.eyeLookDownLeft + scores.eyeLookDownRight) / 2;
    
    let isLookingAtScreen = true;
    let message = 'Good Eye Contact';
    let color = 'text-green-600';
    let direction = 'Center';

    if (lookLeft > currentThreshold) {
      isLookingAtScreen = false;
      message = 'Looking Left';
      color = 'text-red-600';
      direction = 'Left';
    } else if (lookRight > currentThreshold) {
      isLookingAtScreen = false;
      message = 'Looking Right';
      color = 'text-red-600';
      direction = 'Right';
    } else if (lookUp > lookUpThreshold) {
      isLookingAtScreen = false;
      message = 'Looking Up';
      color = 'text-orange-600';
      direction = 'Up';
    } else if (lookDown > currentThreshold) {
      isLookingAtScreen = false;
      message = 'Looking Down';
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

    // Limit FPS to 30
    const delta = time - lastProcessTimeRef.current;
    if (delta < FRAME_INTERVAL) {
      animationFrameRef.current = requestAnimationFrame(loop);
      return;
    }
    lastProcessTimeRef.current = time - (delta % FRAME_INTERVAL);

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
      
      setFaceCount(result.faceLandmarks?.length || 0);

      if (result.faceBlendshapes && result.faceBlendshapes.length > 0) {
        setBlendShapes(result.faceBlendshapes);
        const { isLookingAtScreen } = analyzeGaze(result.faceBlendshapes);

        // --- Eye Contact Logic with Grace Period ---
        if (isRecording && !isPaused) {
          const now = Date.now();
          // Initialize lastFrameTime if needed
          if (lastFrameTimeRef.current === 0) lastFrameTimeRef.current = now;
          
          const frameDuration = now - lastFrameTimeRef.current;
          totalSessionTimeRef.current += frameDuration;

          if (isLookingAtScreen) {
            // User is focused: Reset look away timer
            lookAwayStartTimeRef.current = null;
            focusedTimeRef.current += frameDuration;
          } else {
            // User is looking away
            if (lookAwayStartTimeRef.current === null) {
              lookAwayStartTimeRef.current = now;
            }

            const timeSinceLookAway = now - lookAwayStartTimeRef.current;

            // Grace period check
            if (timeSinceLookAway < GRACE_PERIOD_MS) {
              // Still within grace period, count as focused
              focusedTimeRef.current += frameDuration;
            } else {
              // Grace period exceeded, do NOT increment focusedTimeRef
              // This implicitly lowers the average score over time
            }
          }

          // Update Score (avoid division by zero)
          if (totalSessionTimeRef.current > 0) {
            const score = Math.round((focusedTimeRef.current / totalSessionTimeRef.current) * 100);
            eyeContactScoreRef.current = score;
            
            // Update UI periodically (e.g., every 500ms or just stick to frame updates since 30fps isn't too heavy for one number)
            setRealTimeEyeContact(score);
          }
          
          lastFrameTimeRef.current = now;
        } else {
          // Reset timing references when not recording
          lastFrameTimeRef.current = 0;
        }
      }
    }

    animationFrameRef.current = requestAnimationFrame(loop);
  }, [cameraActive, mpStatus, detectForVideo, drawResults, analyzeGaze, isCalibrating, showMesh, isRecording, isPaused]);

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
      // Reset metrics on new recording
      totalSessionTimeRef.current = 0;
      focusedTimeRef.current = 0;
      eyeContactScoreRef.current = 100;
      lookAwayStartTimeRef.current = null;
      lastFrameTimeRef.current = 0;
      setRealTimeEyeContact(100);
    }
  };
  
  const handlePauseRecording = () => {
    setIsPaused(true);
    // Reset last frame time so we don't count the paused duration as a massive "frame"
    lastFrameTimeRef.current = 0;
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

  // Mock feedback for demonstration (mixed with real gaze)
  const feedbackMetrics = {
    speakingPace: 131,
    eyeContact: realTimeEyeContact, // Use calculated average
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
  
  // Helper to get gaze icon based on direction
  const getGazeIcon = () => {
    if (gazeStatus.isLookingAtScreen) return <CheckCircle2 className="w-8 h-8 text-green-600" />;
    
    switch (gazeStatus.direction) {
      case 'Left': return <ArrowLeft className="w-8 h-8 text-red-600" />;
      case 'Right': return <ArrowRight className="w-8 h-8 text-red-600" />;
      case 'Up': return <ArrowUp className="w-8 h-8 text-orange-500" />;
      case 'Down': return <ArrowDown className="w-8 h-8 text-orange-500" />;
      default: return <AlertCircle className="w-8 h-8 text-red-600" />;
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 2xl:max-w-[1600px] 2xl:py-12">
      {/* Title and Timer Row */}
      <div className="mb-6 flex items-center justify-between 2xl:mb-10">
        <div className="flex items-start gap-4">
          <button 
            onClick={onBack}
            className="group mt-1 flex h-10 w-10 items-center justify-center rounded-full bg-white border border-gray-200 text-gray-500 shadow-sm transition-all duration-300 ease-out hover:border-maroon-200 hover:bg-maroon-50 hover:text-maroon-700 hover:shadow-md"
            title="Exit Session"
          >
            <ArrowLeft className="w-5 h-5 transition-transform duration-300 ease-out group-hover:-translate-x-1" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 font-serif italic sm:text-2xl 2xl:text-4xl">
              Practice Your Presentation
            </h1>
            <p className="mt-1 text-sm text-gray-500 font-sans 2xl:text-xl">
              Presenting to: <span className="text-maroon-700 font-medium">{ACADEMIC_PERSONA.title}</span>
            </p>
          </div>
        </div>
        
        <div className="text-right">
          <div className="text-2xl font-bold text-gray-900 font-mono 2xl:text-4xl">
            {formatTime(timer)}
          </div>
          <div className="text-xs text-gray-500 font-sans 2xl:text-base">Recording Time</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 2xl:gap-10">
        {/* Left Column: Camera View */}
        <div className="lg:col-span-2 space-y-6">
          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-gray-900 shadow-lg group">
            {/* Status Badges */}
            <div className="absolute left-4 top-4 z-10 flex gap-2">
              {isRecording && !isPaused && (
                <div className="flex items-center gap-2 rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white animate-pulse">
                  <div className="h-2 w-2 rounded-full bg-white" />
                  Recording
                </div>
              )}
              {isPaused && (
                <div className="flex items-center gap-2 rounded-full bg-yellow-500 px-3 py-1 text-xs font-medium text-white">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                  Paused
                </div>
              )}
              {isCalibrating && !isRecording && (
                <div className="flex items-center gap-2 rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white">
                  <ScanFace className="w-3 h-3" />
                  Calibration Mode
                </div>
              )}
            </div>

            {/* Video Element */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${cameraActive ? 'opacity-100' : 'opacity-0'}`}
              style={{ transform: 'scaleX(-1)' }}
            />
            
            {/* Canvas for Mesh (Only visible in Calibration Mode) */}
            <canvas
              ref={canvasRef}
              className={`absolute inset-0 h-full w-full object-cover pointer-events-none transition-opacity duration-300 ${isCalibrating ? 'opacity-100' : 'opacity-0'}`}
              style={{ transform: 'scaleX(-1)' }}
            />

            {/* Inactive State / Permission Request */}
            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-gray-900 z-20">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-4 text-gray-500">
                    <path d="M23 7l-7 5 7 5V7z" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
                <h3 className="text-xl font-semibold text-white mb-2">Ready to Practice?</h3>
                <p className="text-sm text-gray-400 mb-6 max-w-md text-center">
                  Enable your camera to start the calibration process. We'll check your lighting and positioning before recording.
                </p>
                <button 
                  onClick={() => startCamera()}
                  className="rounded-full bg-maroon-600 px-8 py-3 text-base font-medium text-white shadow-lg hover:bg-maroon-700 active:scale-95 transition-all"
                >
                  Turn On Camera & Calibrate
                </button>
                {permissionDenied && (
                  <p className="mt-4 text-sm text-red-400">
                    Camera access denied. Please check your browser permissions.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Controls - Only visible when camera is ready and calibration is done */}
          {cameraActive && !isCalibrating && (
            <div className="flex justify-center gap-4 animate-fade-in">
              {!isRecording ? (
                <button
                  onClick={handleStartRecording}
                  className="flex items-center gap-2 rounded-lg bg-maroon-600 px-8 py-3 text-base font-medium text-white shadow-md transition-all hover:bg-maroon-700 hover:shadow-lg active:scale-[0.98] 2xl:px-10 2xl:py-4 2xl:text-xl"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 7l-7 5 7 5V7z" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                  Start Recording
                </button>
              ) : (
                <>
                  {!isPaused ? (
                    <button
                      onClick={handlePauseRecording}
                      className="flex items-center gap-2 rounded-lg bg-yellow-500 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-yellow-600 active:scale-[0.98] 2xl:px-8 2xl:py-3.5 2xl:text-lg"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                      Pause
                    </button>
                  ) : (
                    <button
                      onClick={handleResumeRecording}
                      className="flex items-center gap-2 rounded-lg bg-green-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-green-700 active:scale-[0.98] 2xl:px-8 2xl:py-3.5 2xl:text-lg"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                      Resume
                    </button>
                  )}
                  
                  <button
                    onClick={handleStopRecording}
                    className="flex items-center gap-2 rounded-lg bg-red-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-red-700 active:scale-[0.98] 2xl:px-8 2xl:py-3.5 2xl:text-lg"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>
                    Stop & Review
                  </button>
                </>
              )}
            </div>
          )}
          
          {/* Recalibrate Button - small text button when ready/recording */}
          {cameraActive && !isCalibrating && !isRecording && (
             <div className="flex justify-center mt-2">
               <button 
                 onClick={() => setIsCalibrating(true)}
                 className="text-sm text-gray-500 hover:text-maroon-600 underline"
               >
                 Re-enter Calibration Mode
               </button>
             </div>
          )}
        </div>

        {/* Right Column: Dynamic Panel (Feedback OR Calibration) */}
        <div className="lg:col-span-1">
          <div className="h-full rounded-xl border border-gray-200 bg-white p-6 shadow-sm 2xl:p-8 relative overflow-hidden">
            
            {/* Render Calibration Panel OR Feedback Panel */}
            {isCalibrating ? (
              <div className="animate-fade-in flex flex-col h-full">
                 <div className="flex items-center gap-2 mb-4 border-b pb-4">
                    <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold shrink-0">1</div>
                    <h3 className="font-serif text-lg font-bold text-gray-900 2xl:text-2xl">Calibration Check</h3>
                 </div>
                 
                 <div className="flex-1 overflow-y-auto space-y-6">
                   {/* Mesh Toggle */}
                   <div className="flex items-center justify-between bg-gray-50 p-3 rounded-lg border border-gray-100">
                      <span className="text-sm font-medium text-gray-700">Show Face Mesh Overlay</span>
                      <button 
                        onClick={() => setShowMesh(!showMesh)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                          showMesh ? 'bg-blue-600' : 'bg-gray-200'
                        }`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          showMesh ? 'translate-x-6' : 'translate-x-1'
                        }`} />
                      </button>
                   </div>

                   {/* Gaze Check */}
                   <div className={`rounded-xl p-5 border-2 text-center transition-all duration-300 ${
                      gazeStatus.isLookingAtScreen 
                        ? 'border-green-100 bg-green-50/50' 
                        : 'border-red-100 bg-red-50/50'
                   }`}>
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Current Gaze Status</p>
                      <div className={`text-3xl font-bold mb-2 flex items-center justify-center gap-2 ${
                        gazeStatus.isLookingAtScreen ? 'text-green-700' : 'text-red-600'
                      }`}>
                        {getGazeIcon()}
                        {gazeStatus.direction}
                      </div>
                      <div className={`text-sm font-medium ${
                         gazeStatus.isLookingAtScreen ? 'text-green-600' : 'text-red-500'
                      }`}>
                        {gazeStatus.isLookingAtScreen ? "Perfect! You're looking at the camera." : "Please adjust until 'Center' is shown."}
                      </div>
                   </div>

                   {/* Prominent Checklist */}
                   <div>
                      <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                        <span>Setup Checklist</span>
                        <span className="text-xs font-normal text-gray-500">(Self-Check)</span>
                      </h4>
                      <div className="space-y-3">
                        {[
                          { id: 'light', icon: <Sun className="w-5 h-5 text-amber-500" />, text: 'Face is well-lit (no backlight)' },
                          { id: 'pos', icon: <Ruler className="w-5 h-5 text-blue-500" />, text: 'Camera is at eye level' },
                          { id: 'clear', icon: <ScanFace className="w-5 h-5 text-purple-500" />, text: 'Face visible (no masks/hair)' },
                        ].map((item) => (
                          <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 bg-white hover:border-blue-300 transition-colors group cursor-default">
                             <div className="h-8 w-8 rounded-full bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                               {item.icon}
                             </div>
                             <span className="text-sm text-gray-700 font-medium">{item.text}</span>
                          </div>
                        ))}
                      </div>
                   </div>
                 </div>

                 <div className="pt-4 border-t mt-auto">
                   <button 
                     onClick={() => setIsCalibrating(false)}
                     className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg hover:bg-blue-700 hover:shadow-xl transform active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                   >
                     <span>Everything Looks Good</span>
                     <Check className="w-5 h-5" />
                   </button>
                 </div>
              </div>
            ) : (
              <div className="animate-fade-in">
                <h3 className="mb-6 font-serif text-lg font-bold text-gray-900 2xl:text-2xl">Real-time Feedback</h3>

                <div className={`space-y-6 2xl:space-y-8 ${!isRecording ? 'opacity-60 grayscale-[0.5]' : ''}`}>
                  {/* Metric: Speaking Pace */}
                  <div>
                    <div className="flex justify-between text-sm 2xl:text-base">
                      <span className="flex items-center gap-2 text-gray-600">
                        <Volume2 className="w-4 h-4" />
                        Speaking Pace
                      </span>
                      <span className="font-semibold text-gray-900">{isRecording ? feedbackMetrics.speakingPace : '--'} wpm</span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full bg-green-500 transition-all duration-500" style={{ width: isRecording ? '65%' : '0%' }} />
                    </div>
                    <div className="mt-1 text-xs text-gray-400">Target: 130-160 wpm</div>
                  </div>

                  {/* Metric: Eye Contact */}
                  <div>
                    <div className="flex justify-between text-sm 2xl:text-base">
                      <span className="flex items-center gap-2 text-gray-600">
                        <Eye className="w-4 h-4" />
                        Eye Contact
                      </span>
                      <span className={`font-semibold ${!isRecording ? 'text-gray-900' : gazeStatus.isLookingAtScreen ? 'text-green-600' : 'text-red-500'}`}>
                        {isRecording ? `${feedbackMetrics.eyeContact}%` : '--%'}
                      </span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div 
                        className={`h-full transition-all duration-500 ${!isRecording ? 'bg-gray-300' : gazeStatus.isLookingAtScreen ? 'bg-green-500' : 'bg-red-500'}`} 
                        style={{ width: isRecording ? `${feedbackMetrics.eyeContact}%` : '0%' }} 
                      />
                    </div>
                    <div className="mt-1 text-xs text-gray-400">
                      {isRecording ? gazeStatus.message : 'Target: 70%+ camera engagement'}
                    </div>
                  </div>

                  {/* Metric: Volume Level */}
                  <div>
                    <div className="flex justify-between text-sm 2xl:text-base">
                      <span className="flex items-center gap-2 text-gray-600">
                        <Mic className="w-4 h-4" />
                        Volume Level
                      </span>
                      <span className="font-semibold text-gray-900">{isRecording ? `${feedbackMetrics.volumeLevel}%` : '--%'}</span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: isRecording ? `${feedbackMetrics.volumeLevel}%` : '0%' }} />
                    </div>
                    <div className="mt-1 text-xs text-gray-400">Maintain consistent volume</div>
                  </div>

                  {/* Counter Metrics */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-lg border border-gray-100 p-3">
                      <div className="text-xs text-gray-500 2xl:text-sm">Filler Words</div>
                      <div className="mt-1 text-xl font-bold text-green-600 2xl:text-2xl">{isRecording ? feedbackMetrics.fillerWords : '--'}</div>
                      <div className="text-[10px] text-gray-400">um, uh, like, you know</div>
                    </div>
                    <div className="rounded-lg border border-gray-100 p-3">
                      <div className="text-xs text-gray-500 2xl:text-sm">Pauses</div>
                      <div className="mt-1 text-xl font-bold text-gray-900 2xl:text-2xl">{isRecording ? feedbackMetrics.pauses : '--'}</div>
                      <div className="text-[10px] text-gray-400">Strategic pauses detected</div>
                    </div>
                  </div>

                  {/* Live Tip */}
                  <div className="rounded-lg bg-blue-50 p-4 border border-blue-100">
                    <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-blue-700 2xl:text-sm">
                      <span className="text-lg">💡</span> {isRecording ? "Live Tip" : "Coach Tip"}
                    </div>
                    <p className="text-xs text-blue-800 2xl:text-sm">
                      {isRecording 
                        ? (gazeStatus.isLookingAtScreen ? "Great job! Maintain this pace." : "Try to look at the camera.")
                        : "Feedback will appear here once you start recording."}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Timestamped Feedback Scroll */}
      {isRecording && (
        <div className="mt-6 2xl:mt-10 animate-slide-up">
          <h4 className="mb-4 font-serif text-base font-semibold text-gray-900 2xl:text-xl">Timestamped Feedback</h4>
          <div className="max-h-[200px] space-y-3 overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-sm 2xl:p-6">
            {feedbackEvents.map((event, index) => (
              <div 
                key={index}
                className={`flex items-center justify-between rounded-lg border-l-4 p-3 2xl:p-4
                  ${event.type === 'warning' ? 'border-yellow-400 bg-yellow-50' : 
                    event.type === 'info' ? 'border-blue-400 bg-blue-50' : 
                    'border-green-400 bg-green-50'}
                `}
              >
                <div className="flex items-center gap-4">
                  <span className="font-mono text-xs font-medium text-gray-500 2xl:text-sm">{event.time}</span>
                  <span className="text-sm font-medium text-gray-900 2xl:text-base">{event.message}</span>
                </div>
                <span className="text-lg">
                  {event.type === 'warning' ? '⚠️' : event.type === 'info' ? '📢' : '👁️'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer Navigation */}
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
