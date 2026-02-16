'use client';

import React, { useState, useRef, useEffect } from 'react';
import { PERSONA_CUSTOMIZATION } from '../config/config';
import { savePersonaCustomization } from '../services/api';

interface CustomizePersonaProps {
  value: string;
  onChange: (value: string) => void;
  sessionId: string;
  isVisible: boolean;
}

function countWords(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

export default function CustomizePersona({
  value,
  onChange,
  sessionId,
  isVisible,
}: CustomizePersonaProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wordCount = countWords(value);
  const isOverLimit = wordCount > PERSONA_CUSTOMIZATION.MAX_WORDS;
  const hasContent = value.trim().length > 0;

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [isExpanded, isVisible, saving, saved, error, wordCount]);

  useEffect(() => {
    if (!isVisible) setIsExpanded(false);
  }, [isVisible]);

  // Reset saved indicator when text changes after a save
  useEffect(() => {
    setSaved(false);
    setError(null);
  }, [value]);

  const handleSave = async () => {
    if (!hasContent || isOverLimit) return;
    setSaving(true);
    setError(null);
    try {
      await savePersonaCustomization(sessionId, value.trim());
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!isVisible) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Collapsible Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-gray-50 2xl:px-8 2xl:py-6"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 2xl:text-xl">
            Customize Persona (Optional)
          </span>
          {/* Saved badge in the header — visible when collapsed */}
          {saved && !isExpanded && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-600 2xl:text-xs 2xl:px-2.5">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="currentColor" />
              </svg>
              Saved
            </span>
          )}
        </div>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          className={`
            text-gray-400 transition-transform duration-300 ease-out 2xl:h-6 2xl:w-6
            ${isExpanded ? 'rotate-180' : 'rotate-0'}
          `}
        >
          <path
            d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"
            fill="currentColor"
          />
        </svg>
      </button>

      {/* Collapsible Content */}
      <div
        className="transition-all duration-300 ease-out overflow-hidden"
        style={{ maxHeight: isExpanded ? `${contentHeight + 40}px` : '0px' }}
      >
        <div ref={contentRef} className="px-5 pb-5 2xl:px-8 2xl:pb-8">
          <label className="mb-3 block text-sm font-medium text-gray-700 2xl:text-lg 2xl:mb-4">
            Additional Notes or Modifications
          </label>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Add any specific details about your audience that will help tailor the feedback (e.g., specific technical background, time constraints, cultural considerations...)"
            className={`
              min-h-[100px] w-full resize-none rounded-xl border
              bg-gray-50 p-4 text-sm text-gray-600 placeholder-gray-400
              transition-all duration-200
              focus:bg-white focus:outline-none focus:ring-2
              2xl:text-lg 2xl:min-h-[150px]
              ${isOverLimit
                ? 'border-red-300 focus:border-red-400 focus:ring-red-200'
                : 'border-gray-200 focus:border-maroon focus:ring-maroon/20'
              }
            `}
          />

          {/* Footer row: word count left, save status + button right */}
          <div className="mt-2.5 flex items-center justify-between 2xl:mt-3">
            <span className={`text-xs font-sans 2xl:text-sm ${isOverLimit ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
              {wordCount}/{PERSONA_CUSTOMIZATION.MAX_WORDS} words
              {isOverLimit && <span className="ml-1">— please shorten</span>}
            </span>

            <div className="flex items-center gap-2.5">
              {error && (
                <span className="text-xs text-red-500 font-sans 2xl:text-sm">{error}</span>
              )}
              <button
                onClick={handleSave}
                disabled={saving || !hasContent || isOverLimit || saved}
                className={`
                  inline-flex items-center justify-center gap-1.5 rounded-lg
                  px-3 py-1.5 text-xs font-medium
                  shadow-sm transition-all duration-300 ease-out
                  font-sans 2xl:px-4 2xl:py-2 2xl:text-sm
                  ${saved
                    ? 'bg-green-500 text-white scale-105 shadow-green-200'
                    : saving
                      ? 'bg-maroon-600 text-white opacity-80 cursor-wait'
                      : 'bg-maroon-600 text-white hover:bg-maroon-700 hover:shadow-md active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-maroon-600'
                  }
                `}
                style={{ minWidth: '90px' }}
              >
                {saved ? (
                  <span className="inline-flex items-center gap-1.5 animate-[fadeScale_0.35s_ease-out]">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      className="2xl:h-4 2xl:w-4"
                    >
                      <path
                        d="M4.5 12.75l6 6 9-13.5"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="animate-[drawCheck_0.4s_ease-out_0.1s_both]"
                        style={{
                          strokeDasharray: 30,
                          strokeDashoffset: 30,
                        }}
                      />
                    </svg>
                    Saved
                  </span>
                ) : saving ? (
                  <span className="inline-flex items-center gap-1.5">
                    <svg className="h-3 w-3 animate-spin 2xl:h-3.5 2xl:w-3.5" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="2" strokeDasharray="10 20" />
                    </svg>
                    Saving…
                  </span>
                ) : (
                  'Save Notes'
                )}
              </button>

              {/* Keyframe styles for the micro-interaction */}
              <style jsx>{`
                @keyframes drawCheck {
                  to {
                    stroke-dashoffset: 0;
                  }
                }
                @keyframes fadeScale {
                  0% {
                    opacity: 0;
                    transform: scale(0.85);
                  }
                  50% {
                    opacity: 1;
                    transform: scale(1.05);
                  }
                  100% {
                    opacity: 1;
                    transform: scale(1);
                  }
                }
              `}</style>
            </div>
          </div>

          <p className="mt-2 text-xs text-gray-500 2xl:text-base 2xl:mt-3">
            These notes will help the AI provide more personalized feedback for your specific presentation context.
          </p>
        </div>
      </div>
    </div>
  );
}
