'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Video, VideoOff } from 'lucide-react';

export default function QACameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);

  const startCamera = useCallback(async () => {
    if (mediaStreamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadeddata = () => {
          if (mountedRef.current) setCameraActive(true);
        };
      }
    } catch {
      if (mountedRef.current) setPermissionDenied(true);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    startCamera();
    return () => {
      mountedRef.current = false;
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
      }
    };
  }, [startCamera]);

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-gray-900 shadow-lg aspect-video">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
          cameraActive ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ transform: 'scaleX(-1)' }}
      />

      {!cameraActive && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-gray-900 z-20">
          {permissionDenied ? (
            <>
              <VideoOff size={40} className="mb-3 text-gray-500" />
              <p className="text-sm text-gray-400 font-sans">Camera access denied</p>
              <button
                onClick={startCamera}
                className="mt-3 rounded-lg bg-maroon px-4 py-2 text-sm font-medium text-white hover:bg-maroon/90 transition font-sans"
              >
                Retry
              </button>
            </>
          ) : (
            <>
              <Video size={40} className="mb-3 text-gray-500 animate-pulse" />
              <p className="text-sm text-gray-400 font-sans">Starting camera...</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
