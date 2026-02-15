'use client';

import React from 'react';

interface PersonaCardProps {
  name: string;
  description: string;
  personaPrompt?: string;
  isSelected: boolean;
  onSelect: () => void;
}

export default function PersonaCard({
  name,
  description,
  personaPrompt,
  isSelected,
  onSelect,
}: PersonaCardProps) {
  return (
    <button
      onClick={onSelect}
      className={`
        group relative w-full rounded-xl border-2 bg-white p-5 text-left sm:p-6 2xl:p-10
        transition-all duration-300 ease-out
        ${isSelected 
          ? 'border-maroon bg-maroon/[0.02] shadow-sm' 
          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
        }
      `}
    >
      {/* Selection Checkmark */}
      <div
        className={`
          absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full 2xl:right-6 2xl:top-6 2xl:h-8 2xl:w-8
          transition-all duration-300 ease-out
          ${isSelected 
            ? 'scale-100 bg-maroon opacity-100' 
            : 'scale-0 bg-gray-200 opacity-0'
          }
        `}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          className="text-white 2xl:h-5 2xl:w-5"
        >
          <path
            d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"
            fill="currentColor"
          />
        </svg>
      </div>

      {/* Header */}
      <div className="mb-3 flex items-center gap-4 2xl:mb-5 2xl:gap-6">
        <div
          className={`
            flex h-10 w-10 items-center justify-center rounded-lg 2xl:h-14 2xl:w-14 2xl:rounded-xl
            transition-colors duration-300
            ${isSelected ? 'bg-maroon/10' : 'bg-blue-50'}
          `}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            className={`transition-colors duration-300 2xl:h-8 2xl:w-8 ${isSelected ? 'text-maroon' : 'text-maroon'}`}
          >
            <path
              d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"
              fill="currentColor"
            />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-gray-900 2xl:text-2xl font-serif">{name}</h3>
        </div>
      </div>

      {/* Description */}
      <div className="mb-3 2xl:mb-4">
        <p className="text-sm text-gray-600 leading-relaxed 2xl:text-lg font-sans">{description}</p>
      </div>

      {/* Persona Prompt */}
      {personaPrompt && (
        <div className="border-t border-gray-100 pt-3 2xl:pt-4">
          <div className="mb-2 flex items-center gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              className="text-gray-400 2xl:h-5 2xl:w-5"
            >
              <path
                d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"
                fill="currentColor"
              />
            </svg>
            <span className="text-sm font-medium text-gray-600 2xl:text-lg font-sans">Persona Details</span>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 2xl:p-4">
            <pre className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap font-sans 2xl:text-sm">
              {personaPrompt}
            </pre>
          </div>
        </div>
      )}
    </button>
  );
}
