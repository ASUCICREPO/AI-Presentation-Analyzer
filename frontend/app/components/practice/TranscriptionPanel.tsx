import React, { useRef, useEffect } from 'react';
import { MessageSquareText } from 'lucide-react';
import { TranscriptEntry } from '../../hooks/useAudioAnalysis';
import { AUDIO_ANALYSIS_CONFIG } from '../../config/config';

interface TranscriptionPanelProps {
  transcripts: TranscriptEntry[];
  partialTranscript: string;
  isRecording: boolean;
  isTranscribing: boolean;
}

const { FILLER_WORDS } = AUDIO_ANALYSIS_CONFIG;

/** Highlight filler words in a transcript string */
function highlightFillers(text: string) {
  const words = text.split(/(\s+)/);
  return words.map((word, i) => {
    const clean = word.toLowerCase().replace(/[.,!?;:'"()\-]/g, '');
    if (FILLER_WORDS.includes(clean)) {
      return (
        <span key={i} className="rounded bg-yellow-100 px-0.5 text-yellow-800 font-semibold">
          {word}
        </span>
      );
    }
    return word;
  });
}

export default function TranscriptionPanel({
  transcripts,
  partialTranscript,
  isRecording,
  isTranscribing,
}: TranscriptionPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new transcripts
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts, partialTranscript]);

  return (
    <div className="mt-6 animate-slide-up 2xl:mt-10">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-serif text-base font-semibold text-gray-900 2xl:text-xl flex items-center gap-2">
          <MessageSquareText className="w-5 h-5 text-maroon" />
          Live Transcription
        </h4>
        {isTranscribing && (
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-gray-500 font-sans">Listening</span>
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        className="max-h-[240px] overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3 2xl:p-6 2xl:max-h-[320px]"
      >
        {!isRecording && transcripts.length === 0 && (
          <div className="py-8 text-center">
            <MessageSquareText className="mx-auto mb-3 h-8 w-8 text-gray-300" />
            <p className="text-sm text-gray-400 font-sans">
              Your speech will appear here in real time once you start recording.
            </p>
          </div>
        )}

        {transcripts.map((entry, index) => (
          <div key={index} className="flex gap-3 items-start">
            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-gray-500 mt-0.5">
              {entry.timestamp}
            </span>
            <p className="text-sm text-gray-800 leading-relaxed font-sans">
              {highlightFillers(entry.text)}
            </p>
          </div>
        ))}

        {/* Partial (in-progress) transcript */}
        {partialTranscript && (
          <div className="flex gap-3 items-start opacity-60">
            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-gray-400 mt-0.5">
              ...
            </span>
            <p className="text-sm text-gray-500 italic leading-relaxed font-sans">
              {partialTranscript}
            </p>
          </div>
        )}
      </div>

      <p className="mt-2 text-[11px] text-gray-400 font-sans">
        <span className="inline-block rounded bg-yellow-100 px-1 text-yellow-800">Highlighted words</span> are detected filler words.
      </p>
    </div>
  );
}
