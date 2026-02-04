'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ACADEMIC_PERSONA } from '../config/personas';

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Format time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

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

  // Camera handling
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      streamRef.current = stream;
      setCameraActive(true);
      setPermissionDenied(false);
    } catch (err) {
      console.error("Error accessing camera:", err);
      setPermissionDenied(true);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  // Start camera on mount
  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, []);

  const handleStartRecording = async () => {
    if (!cameraActive) {
      await startCamera();
    }
    if (cameraActive) {
      setIsRecording(true);
      setIsPaused(false);
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
    onComplete(); // Navigate to next step
  };

  // Mock Data for Feedback
  const feedbackMetrics = {
    speakingPace: 131,
    eyeContact: 76,
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
      {/* Title and Timer Row */}
      <div className="mb-6 flex items-end justify-between 2xl:mb-10">
        <div>
          <h1 className="text-xl font-bold text-gray-900 font-serif italic sm:text-2xl 2xl:text-4xl">
            Practice Your Presentation
          </h1>
          <p className="mt-1 text-sm text-gray-500 font-sans 2xl:text-xl">
            Presenting to: <span className="text-maroon-700 font-medium">{ACADEMIC_PERSONA.title}</span>
          </p>
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
          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-gray-900 shadow-lg">
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
            </div>

            {/* Video Element */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`h-full w-full object-cover transition-opacity duration-500 ${cameraActive ? 'opacity-100' : 'opacity-0'}`}
              style={{ transform: 'scaleX(-1)' }}
            />

            {/* Inactive State / Permission Request */}
            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-gray-900">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-4 opacity-50">
                  {permissionDenied ? (
                    <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10" />
                  ) : (
                    <>
                      <path d="M23 7l-7 5 7 5V7z" />
                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                    </>
                  )}
                </svg>
                <span className="text-lg font-medium">
                  {permissionDenied ? "Camera Access Denied" : "Initializing Camera..."}
                </span>
                <span className="text-sm opacity-70 mt-2">
                  {permissionDenied 
                    ? "Please allow camera permissions in your browser settings." 
                    : "Please allow access when prompted."}
                </span>
                {permissionDenied && (
                  <button 
                    onClick={() => startCamera()}
                    className="mt-4 rounded-lg bg-maroon-600 px-4 py-2 text-sm text-white hover:bg-maroon-700"
                  >
                    Retry Access
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex justify-center gap-4">
            {!isRecording ? (
              <button
                onClick={handleStartRecording}
                disabled={!cameraActive && permissionDenied}
                className={`
                  flex items-center gap-2 rounded-lg px-8 py-3 text-base font-medium text-white shadow-md transition-all 
                  2xl:px-10 2xl:py-4 2xl:text-xl
                  ${(!cameraActive && permissionDenied) 
                    ? 'bg-gray-400 cursor-not-allowed' 
                    : 'bg-maroon-600 hover:bg-maroon-700 hover:shadow-lg active:scale-[0.98]'}
                `}
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
        </div>

        {/* Right Column: Feedback */}
        <div className="lg:col-span-1">
          <div className="h-full rounded-xl border border-gray-200 bg-white p-6 shadow-sm 2xl:p-8">
            <h3 className="mb-6 font-serif text-lg font-bold text-gray-900 2xl:text-2xl">Real-time Feedback</h3>

            {!isRecording ? (
              <div className="flex h-64 flex-col items-center justify-center text-center text-gray-400">
                <div className="mb-4 rounded-full bg-gray-50 p-4">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <p className="text-sm 2xl:text-lg">Start recording to see live feedback</p>
              </div>
            ) : (
              <div className="space-y-6 2xl:space-y-8">
                {/* Metric: Speaking Pace */}
                <div>
                  <div className="flex justify-between text-sm 2xl:text-base">
                    <span className="flex items-center gap-2 text-gray-600">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      Speaking Pace
                    </span>
                    <span className="font-semibold text-gray-900">{feedbackMetrics.speakingPace} wpm</span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full bg-green-500 transition-all duration-500" style={{ width: '65%' }} />
                  </div>
                  <div className="mt-1 text-xs text-gray-400">Target: 130-160 wpm</div>
                </div>

                {/* Metric: Eye Contact */}
                <div>
                  <div className="flex justify-between text-sm 2xl:text-base">
                    <span className="flex items-center gap-2 text-gray-600">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      Eye Contact
                    </span>
                    <span className="font-semibold text-gray-900">{feedbackMetrics.eyeContact}%</span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${feedbackMetrics.eyeContact}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-gray-400">Target: 70%+ camera engagement</div>
                </div>

                {/* Metric: Volume Level */}
                <div>
                  <div className="flex justify-between text-sm 2xl:text-base">
                    <span className="flex items-center gap-2 text-gray-600">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                      Volume Level
                    </span>
                    <span className="font-semibold text-gray-900">{feedbackMetrics.volumeLevel}%</span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${feedbackMetrics.volumeLevel}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-gray-400">Maintain consistent volume</div>
                </div>

                {/* Counter Metrics */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-gray-100 p-3">
                    <div className="text-xs text-gray-500 2xl:text-sm">Filler Words</div>
                    <div className="mt-1 text-xl font-bold text-green-600 2xl:text-2xl">{feedbackMetrics.fillerWords}</div>
                    <div className="text-[10px] text-gray-400">um, uh, like, you know</div>
                  </div>
                  <div className="rounded-lg border border-gray-100 p-3">
                    <div className="text-xs text-gray-500 2xl:text-sm">Pauses</div>
                    <div className="mt-1 text-xl font-bold text-gray-900 2xl:text-2xl">{feedbackMetrics.pauses}</div>
                    <div className="text-[10px] text-gray-400">Strategic pauses detected</div>
                  </div>
                </div>

                {/* Live Tip */}
                <div className="rounded-lg bg-blue-50 p-4 border border-blue-100">
                  <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-blue-700 2xl:text-sm">
                    <span className="text-lg">💡</span> Live Tip
                  </div>
                  <p className="text-xs text-blue-800 2xl:text-sm">
                    Great job! Maintain this pace and eye contact.
                  </p>
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
