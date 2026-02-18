'use client';

import React, { useMemo } from 'react';
import { ArrowLeft, ArrowRight, MessageCircle, AlertCircle } from 'lucide-react';
import { useQASession } from '../hooks/useQASession';
import { QAWebSocketConfig } from '../services/websocket';
import { useAuth } from '../context/AuthContext';
import QAVoiceControls from './qa/QAVoiceControls';
import QATranscript from './qa/QATranscript';

interface QASessionProps {
  personaId: string;
  personaName: string;
  sessionId: string;
  userId: string;
  voiceId?: string;
  onBack: () => void;
  onComplete: () => void;
  onSkip: () => void;
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
    }),
    [personaId, sessionId, userId, dateStr, voiceId],
  );

  const qa = useQASession(wsConfig, getIdToken);
  const displayPersonaName = qa.personaName || initialPersonaName;

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 py-6 sm:px-6 2xl:max-w-[1200px]">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {qa.status === 'idle' && (
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-sm text-gray-500 transition hover:text-gray-700 font-sans"
            >
              <ArrowLeft size={16} />
              Back to Practice
            </button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-gray-900 font-serif italic sm:text-3xl">
              Q&A Session
            </h1>
            <p className="mt-1 text-sm text-gray-500 font-sans">
              {displayPersonaName} will ask questions about your presentation
            </p>
          </div>
        </div>

        {(qa.status === 'idle' || qa.status === 'ended' || qa.status === 'error') && (
          <button
            onClick={onSkip}
            className="flex items-center gap-1.5 text-sm text-gray-500 transition hover:text-gray-700 font-sans"
          >
            Skip to Analytics
            <ArrowRight size={16} />
          </button>
        )}
      </div>

      {/* Status banner for ended/error */}
      {qa.status === 'ended' && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageCircle size={18} className="text-green-600" />
              <div>
                <p className="text-sm font-medium text-green-800 font-sans">Q&A Session Complete</p>
                <p className="text-xs text-green-600 font-sans">
                  {qa.transcriptEntries.length} exchanges recorded
                </p>
              </div>
            </div>
            <button
              onClick={onComplete}
              className="flex items-center gap-1.5 rounded-lg bg-maroon px-4 py-2 text-sm font-medium text-white transition hover:bg-maroon/90 font-sans"
            >
              Continue to Analytics
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {qa.error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2">
            <AlertCircle size={18} className="text-red-600" />
            <p className="text-sm text-red-700 font-sans">{qa.error}</p>
          </div>
        </div>
      )}

      {/* Main content grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left: Instructions & Controls */}
        <div className="lg:col-span-1 space-y-4">
          {/* Instructions card */}
          {qa.status === 'idle' && (
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-900 font-sans mb-3">How it works</h3>
              <ul className="space-y-2 text-xs text-gray-600 font-sans">
                <li className="flex items-start gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-maroon/10 text-[10px] font-bold text-maroon">1</span>
                  <span>Click &ldquo;Start Q&A Session&rdquo; to begin</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-maroon/10 text-[10px] font-bold text-maroon">2</span>
                  <span>{displayPersonaName} will ask questions about your presentation</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-maroon/10 text-[10px] font-bold text-maroon">3</span>
                  <span>Answer naturally — speak clearly into your microphone</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-maroon/10 text-[10px] font-bold text-maroon">4</span>
                  <span>The session lasts ~5 minutes, then proceed to analytics</span>
                </li>
              </ul>
            </div>
          )}

          {/* Voice controls */}
          <QAVoiceControls
            status={qa.status}
            timer={qa.timer}
            isMuted={qa.isMuted}
            onStart={qa.startSession}
            onEnd={qa.endSession}
            onToggleMute={qa.toggleMute}
          />

          {/* Session stats (during/after session) */}
          {(qa.status === 'active' || qa.status === 'ended') && (
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 font-sans">Session Stats</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-gray-50 p-2.5 text-center">
                  <p className="text-lg font-bold text-gray-900 font-mono">
                    {qa.transcriptEntries.filter(e => e.role === 'assistant').length}
                  </p>
                  <p className="text-[10px] text-gray-500 font-sans">Questions Asked</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-2.5 text-center">
                  <p className="text-lg font-bold text-gray-900 font-mono">
                    {qa.transcriptEntries.filter(e => e.role === 'user').length}
                  </p>
                  <p className="text-[10px] text-gray-500 font-sans">Your Responses</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Transcript */}
        <div className="lg:col-span-2">
          <QATranscript
            entries={qa.transcriptEntries}
            partialUserText={qa.partialUserText}
            partialAssistantText={qa.partialAssistantText}
            personaName={displayPersonaName}
          />
        </div>
      </div>
    </div>
  );
}
