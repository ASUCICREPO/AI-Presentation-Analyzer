'use client';

import React, { useState, useRef, useEffect } from 'react';

const MAX_WORDS = 500;

interface CustomizePersonaProps {
  value: string;
  onChange: (value: string) => void;
  isVisible: boolean;
}

function countWords(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

export default function CustomizePersona({
  value,
  onChange,
  isVisible,
}: CustomizePersonaProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  const wordCount = countWords(value);
  const isOverLimit = wordCount > MAX_WORDS;

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [isExpanded, isVisible, wordCount]);

  useEffect(() => {
    if (!isVisible) setIsExpanded(false);
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Collapsible Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-gray-50 2xl:px-8 2xl:py-6"
      >
        <span className="text-sm font-medium text-gray-700 2xl:text-xl">
          Customize Persona (Optional)
        </span>
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

          <div className="mt-2.5 flex items-center justify-between 2xl:mt-3">
            <span className={`text-xs font-sans 2xl:text-sm ${isOverLimit ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
              {wordCount}/{MAX_WORDS} words
              {isOverLimit && <span className="ml-1">— please shorten</span>}
            </span>
          </div>

          <p className="mt-2 text-xs text-gray-500 2xl:text-base 2xl:mt-3">
            These notes will help the AI provide more personalized feedback for your specific presentation context.
          </p>
        </div>
      </div>
    </div>
  );
}
