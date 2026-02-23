'use client';

import React from 'react';
import { Orb } from '../ui/orb';
import type { AgentState } from '../ui/orb';
import { Mic, Loader2, MicOff, PhoneOff, ArrowRight } from 'lucide-react';
import { QASessionStatus } from '../../hooks/useQASession';

interface QAOrbPanelProps {
  personaName: string;
  agentState: AgentState;
  status: QASessionStatus;
  isMuted: boolean;
  onStart: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
  onSkip: () => void;
}

const STATE_CONFIG: Record<string, { label: string; dotClass: string; textClass: string }> = {
  listening: { label: 'Listening to you...', dotClass: 'bg-green-500', textClass: 'text-green-600' },
  talking: { label: 'Speaking...', dotClass: 'bg-maroon animate-pulse', textClass: 'text-maroon' },
  thinking: { label: 'Thinking...', dotClass: 'bg-amber-500 animate-pulse', textClass: 'text-amber-600' },
};

export default function QAOrbPanel({
  personaName,
  agentState,
  status,
  isMuted,
  onStart,
  onEnd,
  onToggleMute,
  onSkip,
}: QAOrbPanelProps) {
  const stateInfo = agentState ? STATE_CONFIG[agentState] : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm 2xl:p-6 relative overflow-hidden">
      {/* Orb */}
      <div className="relative w-full h-[240px] 2xl:h-[300px]">
        <Orb
          agentState={agentState}
          colors={["#6366F1", "#A78BFA"]}
          seed={42}
          className="absolute inset-0 h-full w-full"
        />
      </div>

      {/* Persona info */}
      <div className="mt-2 text-center">
        <h4 className="text-base font-semibold text-gray-900 font-serif italic 2xl:text-lg">
          {personaName || 'AI Interviewer'}
        </h4>

        {stateInfo ? (
          <div className="mt-1 flex items-center justify-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${stateInfo.dotClass}`} />
            <span className={`text-xs font-medium font-sans ${stateInfo.textClass}`}>
              {stateInfo.label}
            </span>
          </div>
        ) : status === 'idle' ? (
          <p className="mt-1 text-xs text-gray-400 font-sans">
            Your AI interviewer will ask questions about your presentation
          </p>
        ) : status === 'connecting' ? (
          <p className="mt-1 text-xs text-amber-500 font-sans">Connecting...</p>
        ) : status === 'ended' ? (
          <p className="mt-1 text-xs text-green-600 font-sans">Session complete</p>
        ) : (
          <p className="mt-1 text-xs text-gray-400 font-sans">Ready</p>
        )}
      </div>

      {/* Controls */}
      <div className="mt-4 flex flex-col items-center gap-3">
        {status === 'idle' && (
          <>
            <button
              onClick={onStart}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-maroon px-6 py-3 text-sm font-medium text-white shadow-md transition-all hover:bg-maroon/90 hover:shadow-lg active:scale-[0.98] font-sans"
            >
              <Mic size={18} />
              Start Q&A Session
            </button>
            <button
              onClick={onSkip}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-6 py-2.5 text-sm font-medium text-gray-500 shadow-sm transition-all hover:border-gray-300 hover:bg-gray-50 active:scale-[0.98] font-sans"
            >
              Skip Q&A
              <ArrowRight size={16} />
            </button>
          </>
        )}

        {status === 'connecting' && (
          <div className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-6 py-3 text-sm font-medium text-gray-500 font-sans">
            <Loader2 size={18} className="animate-spin" />
            Connecting...
          </div>
        )}

        {status === 'active' && (
          <>
            <div className="flex items-center justify-center gap-3 w-full">
              <button
                onClick={onToggleMute}
                className={`flex h-10 w-10 items-center justify-center rounded-full transition ${
                  isMuted
                    ? 'bg-red-100 text-red-600 hover:bg-red-200'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
              </button>

              <button
                onClick={onEnd}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-red-700 active:scale-[0.98] font-sans"
              >
                <PhoneOff size={14} />
                End Session
              </button>
            </div>

            {isMuted && (
              <p className="text-[11px] text-red-500 font-sans">
                Microphone muted — AI can&apos;t hear you
              </p>
            )}
          </>
        )}

        {status === 'ending' && (
          <div className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-6 py-3 text-sm font-medium text-gray-500 font-sans">
            <Loader2 size={18} className="animate-spin" />
            Ending session...
          </div>
        )}

        {status === 'ended' && (
          <div className="flex items-center gap-2 text-sm text-green-600 font-sans py-2">
            <Loader2 size={16} className="animate-spin" />
            Moving to analytics...
          </div>
        )}

        {status === 'error' && (
          <>
            <button
              onClick={onStart}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-maroon px-6 py-3 text-sm font-medium text-white shadow-md transition-all hover:bg-maroon/90 active:scale-[0.98] font-sans"
            >
              <Mic size={18} />
              Retry Connection
            </button>
            <button
              onClick={onSkip}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-6 py-2.5 text-sm font-medium text-gray-500 shadow-sm transition-all hover:border-gray-300 hover:bg-gray-50 active:scale-[0.98] font-sans"
            >
              Skip Q&A
              <ArrowRight size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
