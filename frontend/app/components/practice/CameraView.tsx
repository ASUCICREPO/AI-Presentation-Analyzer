import React, { RefObject } from 'react';
import { ScanFace } from 'lucide-react';

interface CameraViewProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  cameraActive: boolean;
  isRecording: boolean;
  isPaused: boolean;
  isCalibrating: boolean;
  permissionDenied: boolean;
  compact?: boolean;
  onStartCamera: () => void;
  onStartRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onStopRecording: () => void;
  onReEnterCalibration: () => void;
}

export default function CameraView({
  videoRef,
  canvasRef,
  cameraActive,
  isRecording,
  isPaused,
  isCalibrating,
  permissionDenied,
  compact = false,
  onStartCamera,
  onStartRecording,
  onPauseRecording,
  onResumeRecording,
  onStopRecording,
  onReEnterCalibration
}: CameraViewProps) {
  return (
    <div className="space-y-3">
      <div
        className={`relative w-full overflow-hidden rounded-xl bg-gray-900 shadow-lg group aspect-video transition-all duration-500 ${
          compact ? 'mx-auto max-w-[900px]' : ''
        }`}
      >
        {/* Status Badges */}
        <div className="absolute left-4 top-4 z-10 flex gap-2">
          {isRecording && !isPaused && (
            <div className="flex items-center gap-2 rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white animate-pulse font-sans">
              <div className="h-2 w-2 rounded-full bg-white" />
              Recording
            </div>
          )}
          {isPaused && (
            <div className="flex items-center gap-2 rounded-full bg-yellow-500 px-3 py-1 text-xs font-medium text-white font-sans">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
              Paused
            </div>
          )}
          {isCalibrating && !isRecording && (
            <div className="flex items-center gap-2 rounded-full bg-maroon px-3 py-1 text-xs font-medium text-white font-sans">
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
            <h3 className="text-xl font-semibold text-white mb-2 font-serif">Ready to Practice?</h3>
            <p className="text-sm text-gray-400 mb-6 max-w-md text-center font-sans">
              Enable your camera to start the calibration process. We&apos;ll check your lighting and positioning before recording.
            </p>
            <button 
              onClick={onStartCamera}
              className="rounded-full bg-maroon px-8 py-3 text-base font-medium text-white shadow-lg hover:bg-maroon-dark active:scale-95 transition-all font-sans"
            >
              Turn On Camera &amp; Calibrate
            </button>
            {permissionDenied && (
              <p className="mt-4 text-sm text-red-400 font-sans">
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
              onClick={onStartRecording}
              className="flex items-center gap-2 rounded-lg bg-maroon px-8 py-3 text-base font-medium text-white shadow-md transition-all hover:bg-maroon-dark hover:shadow-lg active:scale-[0.98] 2xl:px-10 2xl:py-4 2xl:text-xl font-sans"
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
                  onClick={onPauseRecording}
                  className="flex items-center gap-2 rounded-lg bg-yellow-500 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-yellow-600 active:scale-[0.98] 2xl:px-8 2xl:py-3.5 2xl:text-lg font-sans"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                  Pause
                </button>
              ) : (
                <button
                  onClick={onResumeRecording}
                  className="flex items-center gap-2 rounded-lg bg-green-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-green-700 active:scale-[0.98] 2xl:px-8 2xl:py-3.5 2xl:text-lg font-sans"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  Resume
                </button>
              )}
              
              <button
                onClick={onStopRecording}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-red-700 active:scale-[0.98] 2xl:px-8 2xl:py-3.5 2xl:text-lg font-sans"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>
                Stop & Review
              </button>
            </>
          )}
        </div>
      )}
      
      {/* Recalibrate Button */}
      {cameraActive && !isCalibrating && !isRecording && (
         <div className="flex justify-center mt-2">
           <button 
             onClick={onReEnterCalibration}
             className="text-sm text-gray-500 hover:text-maroon underline font-sans"
           >
             Re-enter Calibration Mode
           </button>
         </div>
      )}
    </div>
  );
}
