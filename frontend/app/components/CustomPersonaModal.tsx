'use client';

import React from 'react';
import { Persona } from '../config/config';

interface CustomPersonaModalProps {
  isOpen: boolean;
  isLoading: boolean;
  persona: Persona | null;
  error: string | null;
  onConfirm: () => void;
  onChangeSelection: () => void;
}

export default function CustomPersonaModal({
  isOpen,
  isLoading,
  persona,
  error,
  onConfirm,
  onChangeSelection,
}: CustomPersonaModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div className="relative mx-4 w-full max-w-[640px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl 2xl:max-w-[860px]">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center px-8 py-16 2xl:py-24">
            <div className="relative mb-8 h-20 w-20 2xl:h-28 2xl:w-28">
              <div className="absolute inset-0 animate-ping rounded-full bg-maroon/20" />
              <div className="absolute inset-2 animate-pulse rounded-full bg-maroon/10" />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg
                  className="h-10 w-10 animate-spin text-maroon 2xl:h-14 2xl:w-14"
                  viewBox="0 0 48 48"
                  fill="none"
                >
                  <circle
                    cx="24" cy="24" r="20"
                    stroke="currentColor" strokeWidth="3"
                    strokeLinecap="round" strokeDasharray="80 40"
                    opacity="0.3"
                  />
                  <circle
                    cx="24" cy="24" r="20"
                    stroke="currentColor" strokeWidth="3"
                    strokeLinecap="round" strokeDasharray="30 90"
                  />
                </svg>
              </div>
            </div>
            <h2 className="text-xl font-bold text-gray-900 font-serif italic 2xl:text-3xl">
              Generating Custom Persona
            </h2>
            <p className="mt-2 text-sm text-gray-500 font-sans 2xl:text-lg">
              Blending your selected personas with AI...
            </p>
          </div>
        ) : error ? (
          <div className="px-8 py-12 2xl:px-12 2xl:py-16">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 2xl:h-14 2xl:w-14">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-red-600 2xl:h-7 2xl:w-7">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="currentColor" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900 font-serif italic 2xl:text-3xl">
                Generation Failed
              </h2>
            </div>
            <p className="text-sm text-red-600 font-sans 2xl:text-base">{error}</p>
            <div className="mt-8 flex justify-end">
              <button
                onClick={onChangeSelection}
                className="rounded-lg bg-maroon px-5 py-2.5 text-sm font-medium text-white font-sans transition-all hover:bg-maroon-dark 2xl:px-8 2xl:py-4 2xl:text-lg"
              >
                Back to Selection
              </button>
            </div>
          </div>
        ) : persona ? (
          <div>
            {/* Header with thin maroon accent */}
            <div className="border-b border-gray-300 px-8 pt-8 pb-5 2xl:px-12 2xl:pt-10 2xl:pb-6">
              <div className="flex items-center gap-2.5 mb-1">
                <div className="h-2 w-2 rounded-full bg-maroon" />
                <span className="text-xs font-medium uppercase tracking-widest text-maroon/70 font-sans 2xl:text-sm">
                  Custom Persona
                </span>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 font-serif italic 2xl:text-4xl">
                {persona.name}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-gray-500 font-sans 2xl:text-base">
                {persona.description}
              </p>
            </div>

            {/* Details */}
            <div className="px-8 py-6 2xl:px-12 2xl:py-8">
              <div className="grid grid-cols-2 gap-x-8 gap-y-5 2xl:gap-x-12 2xl:gap-y-6">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-maroon/60 font-sans 2xl:text-xs">
                    Expertise
                  </span>
                  <p className="mt-1 text-sm text-gray-800 font-sans leading-relaxed 2xl:text-base">
                    {persona.expertise}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-maroon/60 font-sans 2xl:text-xs">
                    Presentation Time
                  </span>
                  <p className="mt-1 text-sm text-gray-800 font-sans 2xl:text-base">
                    {persona.presentationTime}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-maroon/60 font-sans 2xl:text-xs">
                    Communication Style
                  </span>
                  <p className="mt-1 text-sm text-gray-800 font-sans leading-relaxed 2xl:text-base">
                    {persona.communicationStyle}
                  </p>
                </div>
                {persona.timeLimitSec && (
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-maroon/60 font-sans 2xl:text-xs">
                      Time Limit
                    </span>
                    <p className="mt-1 text-sm text-gray-800 font-sans 2xl:text-base">
                      {Math.round(persona.timeLimitSec / 60)} minutes
                    </p>
                  </div>
                )}
              </div>

              {persona.keyPriorities && persona.keyPriorities.length > 0 && (
                <div className="mt-6 pt-5 border-t border-gray-300 2xl:mt-8 2xl:pt-6">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-maroon/60 font-sans 2xl:text-xs">
                    Key Priorities
                  </span>
                  <div className="mt-2.5 flex flex-wrap gap-2 2xl:gap-2.5">
                    {persona.keyPriorities.map((priority, i) => (
                      <span
                        key={i}
                        className="rounded-full bg-gray-50 border border-gray-200 px-3.5 py-1 text-xs text-gray-700 font-sans 2xl:text-sm 2xl:px-4 2xl:py-1.5"
                      >
                        {priority}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between border-t border-gray-300 px-8 py-4 2xl:px-12 2xl:py-5">
              <button
                onClick={onChangeSelection}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 font-sans 2xl:px-6 2xl:py-3.5 2xl:text-lg"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="2xl:h-5 2xl:w-5">
                  <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z" fill="currentColor" />
                </svg>
                Change Selection
              </button>
              <button
                onClick={onConfirm}
                className="group flex items-center gap-2 rounded-lg bg-maroon px-5 py-2.5 text-sm font-medium text-white shadow-sm font-sans transition-all duration-200 ease-out hover:bg-maroon-dark hover:shadow-md active:scale-[0.98] 2xl:px-8 2xl:py-4 2xl:text-lg 2xl:rounded-xl"
              >
                Looks Good
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="transition-transform duration-200 group-hover:translate-x-0.5 2xl:h-6 2xl:w-6">
                  <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" fill="currentColor" />
                </svg>
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
