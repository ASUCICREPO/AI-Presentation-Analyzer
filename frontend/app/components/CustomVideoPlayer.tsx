'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { getManifestData } from '../services/api';
import { Play, Pause, Volume2, VolumeX, Maximize } from 'lucide-react';

interface CustomVideoPlayerProps {
  sessionId: string;
  videoUrl: string;
  className?: string;
  onTimeUpdate?: (currentTime: number) => void;
}

export interface CustomVideoPlayerHandle {
  play: () => void;
  pause: () => void;
  seekTo: (timeInSeconds: number) => void;
}

export const CustomVideoPlayer = forwardRef<CustomVideoPlayerHandle, CustomVideoPlayerProps>(
  ({ sessionId, videoUrl, className, onTimeUpdate }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [manifestDuration, setManifestDuration] = useState<number | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);

    // Fetch manifest on mount
    useEffect(() => {
      getManifestData(sessionId).then(manifest => {
        if (manifest?.duration) {
          setManifestDuration(manifest.duration);
          console.log('[CustomVideoPlayer] Manifest duration loaded:', manifest.duration);
        }
      });
    }, [sessionId]);

    // Use manifest duration if available, otherwise fall back to video duration
    const displayDuration = manifestDuration ?? videoRef.current?.duration ?? 0;

    // Expose control methods via ref
    useImperativeHandle(ref, () => ({
      play: () => videoRef.current?.play(),
      pause: () => videoRef.current?.pause(),
      seekTo: (time: number) => {
        if (videoRef.current) {
          videoRef.current.currentTime = time;
        }
      },
    }));

    // Event handlers for video element
    const handleTimeUpdate = () => {
      if (videoRef.current) {
        const time = videoRef.current.currentTime;
        setCurrentTime(time);
        onTimeUpdate?.(time);
      }
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
      if (!videoRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      videoRef.current.currentTime = pos * displayDuration;
    };

    const togglePlayPause = () => {
      if (videoRef.current) {
        isPlaying ? videoRef.current.pause() : videoRef.current.play();
      }
    };

    const toggleMute = () => {
      if (videoRef.current) {
        videoRef.current.muted = !isMuted;
        setIsMuted(!isMuted);
      }
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVolume = parseFloat(e.target.value);
      setVolume(newVolume);
      if (videoRef.current) {
        videoRef.current.volume = newVolume;
        if (newVolume === 0) {
          setIsMuted(true);
        } else if (isMuted) {
          setIsMuted(false);
        }
      }
    };

    const toggleFullscreen = () => {
      if (videoRef.current) {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          videoRef.current.requestFullscreen();
        }
      }
    };

    const formatTime = (seconds: number) => {
      if (!isFinite(seconds)) return '0:00';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
      <div className={className}>
        {/* Video element without controls */}
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full rounded-lg"
          preload="metadata"
          onTimeUpdate={handleTimeUpdate}
          onPlay={handlePlay}
          onPause={handlePause}
        />

        {/* Custom controls UI - YouTube style */}
        <div className="group mt-2 space-y-2 rounded-lg p-3 transition-all hover:bg-black/80">
          {/* Seek bar */}
          <div
            className="relative h-1 cursor-pointer rounded-full bg-white/30 transition-all hover:h-1.5"
            onClick={handleSeek}
          >
            <div
              className="absolute h-full rounded-full bg-red-600 transition-all"
              style={{ width: `${displayDuration > 0 ? (currentTime / displayDuration) * 100 : 0}%` }}
            />
          </div>

          {/* Control buttons and time display */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Play/Pause */}
              <button
                onClick={togglePlayPause}
                className="rounded-full p-1.5 text-white transition-colors hover:bg-white/20"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </button>

              {/* Time display */}
              <span className="text-sm font-medium text-white">
                {formatTime(currentTime)} / {formatTime(displayDuration)}
              </span>
            </div>

            {/* Volume and fullscreen controls */}
            <div className="flex items-center gap-2">
              {/* Volume button */}
              <button
                onClick={toggleMute}
                className="rounded-full p-1.5 text-white transition-colors hover:bg-white/20"
                aria-label={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>

              {/* Volume slider */}
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={volume}
                onChange={handleVolumeChange}
                className="h-1 w-20 cursor-pointer accent-white"
                aria-label="Volume"
              />

              {/* Fullscreen button */}
              <button
                onClick={toggleFullscreen}
                className="rounded-full p-1.5 text-white transition-colors hover:bg-white/20"
                aria-label="Fullscreen"
              >
                <Maximize className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

CustomVideoPlayer.displayName = 'CustomVideoPlayer';
