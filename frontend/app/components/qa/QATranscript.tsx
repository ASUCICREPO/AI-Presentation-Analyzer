'use client';

import React, { useRef, useEffect } from 'react';
import { QATranscriptEntry } from '../../services/websocket';

interface QATranscriptProps {
  entries: QATranscriptEntry[];
  partialUserText: string;
  partialAssistantText: string;
  personaName: string;
}

export default function QATranscript({ entries, partialUserText, partialAssistantText, personaName }: QATranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, partialUserText, partialAssistantText]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900 font-sans">Live Transcript</h3>
      </div>

      <div ref={scrollRef} className="max-h-[320px] overflow-y-auto px-4 py-3 space-y-3">
        {entries.length === 0 && !partialUserText && !partialAssistantText && (
          <p className="text-sm text-gray-400 text-center py-6 font-sans">
            The conversation transcript will appear here...
          </p>
        )}

        {entries.map((entry, index) => (
          <div key={index} className={`flex gap-3 ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm font-sans ${
                entry.role === 'user'
                  ? 'bg-maroon text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              <span className="block text-[10px] font-medium opacity-70 mb-0.5">
                {entry.role === 'user' ? 'You' : personaName}
              </span>
              {entry.text}
            </div>
          </div>
        ))}

        {/* Partial transcripts */}
        {partialAssistantText && (
          <div className="flex gap-3 justify-start">
            <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-gray-100 text-gray-500 italic font-sans">
              <span className="block text-[10px] font-medium opacity-70 mb-0.5">{personaName}</span>
              {partialAssistantText}
            </div>
          </div>
        )}

        {partialUserText && (
          <div className="flex gap-3 justify-end">
            <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-maroon/70 text-white/80 italic font-sans">
              <span className="block text-[10px] font-medium opacity-70 mb-0.5">You</span>
              {partialUserText}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
