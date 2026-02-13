'use client';

import React, { useState, useRef, useEffect } from 'react';
import { PERSONA_CUSTOMIZATION } from '../config/config';
import { getPresignedUrl, uploadTextWithPresignedUrl } from '../services/api';

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
      const presigned = await getPresignedUrl('persona_customization', sessionId);
      await uploadTextWithPresignedUrl(value.trim(), presigned);
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
              {saved ? (
                <span className="flex items-center gap-1 text-xs text-green-600 font-sans 2xl:text-sm">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="2xl:h-3.5 2xl:w-3.5">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="currentColor" />
                  </svg>
                  Saved
                </span>
              ) : (
                <button
                  onClick={handleSave}
                  disabled={saving || !hasContent || isOverLimit}
                  className="
                    inline-flex items-center gap-1.5 rounded-lg border border-maroon-200
                    bg-maroon-50 px-3 py-1.5 text-xs font-medium text-maroon-700
                    transition-all duration-150
                    hover:border-maroon-400 hover:bg-maroon-100 hover:text-maroon-800
                    disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-maroon-50
                    font-sans 2xl:px-4 2xl:py-2 2xl:text-sm
                  "
                >
                  {saving ? (
                    <>
                      <svg className="h-3 w-3 animate-spin 2xl:h-3.5 2xl:w-3.5" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="2" strokeDasharray="10 20" />
                      </svg>
                      Saving…
                    </>
                  ) : (
                    'Save Notes'
                  )}
                </button>
              )}
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
