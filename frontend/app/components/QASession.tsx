'use client';

import React, { useMemo, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, AlertCircle, MessageSquareText } from 'lucide-react';
import { useQASession } from '../hooks/useQASession';
import { QAWebSocketConfig } from '../services/websocket';
import { QAAnalyticsResponse } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { QA_SESSION_CONFIG } from '../config/config';
import QACameraView from './qa/QACameraView';
import QAOrbPanel from './qa/QAOrbPanel';

interface QASessionProps {
  personaId: string;
  personaName: string;
  sessionId: string;
  userId: string;
  voiceId?: string;
  onBack: () => void;
  onComplete: (qaPromise: Promise<QAAnalyticsResponse | null>) => void;
  onSkip: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function QASession({
  personaId,
  personaName: initialPersonaName,
  sessionId,
  userId,
  voiceId,
  onBack,
  onComplete,
  onSkip,
}: QASessionProps) {
  const { getIdToken } = useAuth();
  const autoNavigatedRef = useRef(false);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);

  const dateStr = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);

  const wsConfig = useMemo<QAWebSocketConfig>(
    () => ({
      personaId,
      sessionId,
      userId,
      dateStr,
      voiceId,
      getIdToken,
    }),
    [personaId, sessionId, userId, dateStr, voiceId, getIdToken],
  );

  const qa = useQASession(wsConfig, getIdToken);
  const displayPersonaName = qa.personaName || initialPersonaName;

  const remaining = Math.max(0, QA_SESSION_CONFIG.DURATION_SEC - qa.timer);
  const isWarning = remaining <= QA_SESSION_CONFIG.WARNING_AT_SEC;
  const isCritical = remaining <= QA_SESSION_CONFIG.FINAL_WARNING_AT_SEC;

  const handleEndSession = useCallback(() => {
    if (autoNavigatedRef.current) return;
    autoNavigatedRef.current = true;
    const promise = qa.endSession();
    onComplete(promise);
  }, [qa.endSession, onComplete]);

  useEffect(() => {
    if (qa.status === 'ended' && !autoNavigatedRef.current) {
      autoNavigatedRef.current = true;
      onComplete(Promise.resolve(qa.qaAnalytics));
    }
  }, [qa.status, qa.qaAnalytics, onComplete]);

  useEffect(() => {
    if (transcriptScrollRef.current) {
      transcriptScrollRef.current.scrollTop = 0;
    }
  }, [qa.transcriptEntries, qa.partialUserText]);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-3 sm:px-6 sm:py-4 2xl:max-w-[1600px] 2xl:py-8">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between 2xl:mb-6">
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
              Q&A Session
            </h1>
            <p className="mt-1 text-sm text-gray-500 font-sans 2xl:text-xl">
              Presenting to: <span className="text-maroon-700 font-medium">{displayPersonaName}</span>
            </p>
          </div>
        </div>

        {/* Timer */}
        <div className="text-right">
          <div
            className={`
              text-2xl font-bold font-mono 2xl:text-4xl transition-colors duration-300
              ${isCritical ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-gray-900'}
            `}
          >
            {formatTime(qa.timer)}
          </div>
          <div className="text-xs text-gray-500 font-sans 2xl:text-base">
            {qa.status === 'active' && isWarning
              ? `${formatTime(remaining)} remaining`
              : 'Session Time'}
          </div>
        </div>
      </div>

      {qa.error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="flex items-center gap-2">
            <AlertCircle size={18} className="text-red-600" />
            <p className="text-sm text-red-700 font-sans">{qa.error}</p>
          </div>
        </div>
      )}

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-4 2xl:gap-6">
        {/* Left: Camera */}
        <div className="min-w-0" style={{ flex: '2 1 0%' }}>
          <QACameraView />
        </div>

        {/* Right: Orb panel with controls */}
        <div className="min-w-0" style={{ flex: '1 1 0%' }}>
          <QAOrbPanel
            personaName={displayPersonaName}
            agentState={qa.agentState}
            status={qa.status}
            isMuted={qa.isMuted}
            botAudioTrack={qa.botAudioTrack}
            onStart={qa.startSession}
            onEnd={handleEndSession}
            onToggleMute={qa.toggleMute}
            onSkip={onSkip}
          />
        </div>
      </div>

      {/* Live Transcript */}
      <div className="mt-4 animate-slide-up 2xl:mt-6">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-serif text-base font-semibold text-gray-900 2xl:text-xl flex items-center gap-2">
            <MessageSquareText className="w-5 h-5 text-maroon" />
            Live Transcript
          </h4>
          {qa.status === 'active' && (
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-gray-500 font-sans">Listening</span>
            </div>
          )}
        </div>

        <div
          ref={transcriptScrollRef}
          className="max-h-[200px] overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 shadow-sm space-y-2.5 2xl:p-5 2xl:max-h-[280px]"
        >
          {qa.transcriptEntries.length === 0 && !qa.partialUserText && (
            <div className="py-6 text-center">
              <MessageSquareText className="mx-auto mb-3 h-8 w-8 text-gray-300" />
              <p className="text-sm text-gray-400 font-sans">
                The conversation will appear here once the Q&A session starts.
              </p>
            </div>
          )}

          {/* Partial user text (typing indicator) — newest, shown at top */}
          {qa.partialUserText && (
            <div className="flex gap-3 items-start opacity-60">
              <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-gray-400 mt-0.5">
                ...
              </span>
              <p className="text-sm text-gray-500 italic leading-relaxed font-sans">
                {qa.partialUserText}
              </p>
            </div>
          )}

          {/* Finalized entries — newest first */}
          {[...qa.transcriptEntries].reverse().map((entry, index) => (
            <div key={index} className="flex gap-3 items-start">
              <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-medium mt-0.5 ${
                entry.role === 'assistant'
                  ? 'bg-maroon/10 text-maroon'
                  : 'bg-gray-100 text-gray-500'
              }`}>
                {entry.role === 'assistant' ? displayPersonaName : 'You'}
              </span>
              <p className="text-sm text-gray-800 leading-relaxed font-sans">
                {entry.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
