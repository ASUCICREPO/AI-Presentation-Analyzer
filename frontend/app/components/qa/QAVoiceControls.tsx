'use client';

import React from 'react';
import { Mic, MicOff, PhoneOff, Loader2 } from 'lucide-react';
import { QASessionStatus } from '../../hooks/useQASession';
import { QA_SESSION_CONFIG } from '../../config/config';

interface QAVoiceControlsProps {
  status: QASessionStatus;
  timer: number;
  isMuted: boolean;
  onStart: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatRemaining(seconds: number): string {
  const remaining = Math.max(0, QA_SESSION_CONFIG.DURATION_SEC - seconds);
  return formatTime(remaining);
}

export default function QAVoiceControls({ status, timer, isMuted, onStart, onEnd, onToggleMute }: QAVoiceControlsProps) {
  const remaining = QA_SESSION_CONFIG.DURATION_SEC - timer;
  const progress = Math.min(timer / QA_SESSION_CONFIG.DURATION_SEC, 1);
  const isWarning = remaining <= QA_SESSION_CONFIG.WARNING_AT_SEC && remaining > QA_SESSION_CONFIG.FINAL_WARNING_AT_SEC;
  const isCritical = remaining <= QA_SESSION_CONFIG.FINAL_WARNING_AT_SEC;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {/* Timer display */}
      {status === 'active' && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider font-sans">Time Remaining</span>
            <span className={`text-lg font-bold font-mono ${
              isCritical ? 'text-red-600' : isWarning ? 'text-yellow-600' : 'text-gray-900'
            }`}>
              {formatRemaining(timer)}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 w-full rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${
                isCritical ? 'bg-red-500' : isWarning ? 'bg-yellow-500' : 'bg-maroon'
              }`}
              style={{ width: `${progress * 100}%` }}
            />
          </div>

          <div className="mt-1 flex justify-between text-[10px] text-gray-400 font-sans">
            <span>{formatTime(timer)} elapsed</span>
            <span>{formatTime(QA_SESSION_CONFIG.DURATION_SEC)} total</span>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-center gap-3">
        {status === 'idle' && (
          <button
            onClick={onStart}
            className="flex items-center gap-2 rounded-full bg-maroon px-6 py-3 text-sm font-medium text-white transition hover:bg-maroon/90 font-sans"
          >
            <Mic size={18} />
            Start Q&A Session
          </button>
        )}

        {status === 'connecting' && (
          <div className="flex items-center gap-2 rounded-full bg-gray-200 px-6 py-3 text-sm font-medium text-gray-600 font-sans">
            <Loader2 size={18} className="animate-spin" />
            Connecting...
          </div>
        )}

        {status === 'active' && (
          <>
            <button
              onClick={onToggleMute}
              className={`flex h-12 w-12 items-center justify-center rounded-full transition ${
                isMuted
                  ? 'bg-red-100 text-red-600 hover:bg-red-200'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>

            <button
              onClick={onEnd}
              className="flex items-center gap-2 rounded-full bg-red-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-red-700 font-sans"
            >
              <PhoneOff size={16} />
              End Session
            </button>
          </>
        )}

        {(status === 'ending') && (
          <div className="flex items-center gap-2 rounded-full bg-gray-200 px-6 py-3 text-sm font-medium text-gray-600 font-sans">
            <Loader2 size={18} className="animate-spin" />
            Ending session...
          </div>
        )}

        {status === 'error' && (
          <button
            onClick={onStart}
            className="flex items-center gap-2 rounded-full bg-maroon px-6 py-3 text-sm font-medium text-white transition hover:bg-maroon/90 font-sans"
          >
            <Mic size={18} />
            Retry Connection
          </button>
        )}
      </div>

      {/* Mute indicator */}
      {status === 'active' && isMuted && (
        <p className="mt-3 text-center text-xs text-red-500 font-sans">
          Microphone is muted — the AI cannot hear you
        </p>
      )}
    </div>
  );
}
