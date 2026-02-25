'use client';

import React from 'react';

interface PersonaCardProps {
  name: string;
  expertise: string;
  keyPriorities: string[];
  presentationTime: string;
  communicationStyle: string;
  isSelected: boolean;
  onSelect: () => void;
}

export default function PersonaCard({
  name,
  expertise,
  keyPriorities,
  presentationTime,
  communicationStyle,
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
      <div className="mb-4 flex items-center gap-4 2xl:mb-8 2xl:gap-6">
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
        <div>
          <h3 className="text-base font-semibold text-gray-900 2xl:text-2xl font-serif">{name}</h3>
          <p className="text-sm text-gray-500 2xl:text-lg font-sans">Expertise: {expertise}</p>
        </div>
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-4 2xl:gap-x-12 2xl:gap-y-8">
        {/* Key Priorities */}
        <div>
          <div className="mb-2 flex items-center gap-2 2xl:mb-3">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              className="text-gray-400 2xl:h-5 2xl:w-5"
            >
              <path
                d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"
                fill="currentColor"
              />
            </svg>
            <span className="text-sm font-medium text-gray-600 2xl:text-lg font-sans">Key Priorities</span>
          </div>
          <ul className="space-y-1 pl-6 2xl:pl-7 2xl:space-y-2">
            {keyPriorities.map((priority, index) => (
              <li
                key={index}
                className="text-sm text-gray-500 2xl:text-lg font-sans"
              >
                · {priority}
              </li>
            ))}
          </ul>
        </div>

        {/* Presentation Time */}
        <div>
          <div className="mb-2 flex items-center gap-2 2xl:mb-3">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              className="text-gray-400 2xl:h-5 2xl:w-5"
            >
              <path
                d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"
                fill="currentColor"
              />
            </svg>
            <span className="text-sm font-medium text-gray-600 2xl:text-lg font-sans">Presentation Time</span>
          </div>
          <p className="pl-6 text-sm text-gray-500 2xl:text-lg 2xl:pl-7 font-sans">{presentationTime}</p>
        </div>
      </div>

      {/* Communication Style */}
      <div className="mt-4 2xl:mt-8">
        <div className="mb-2 flex items-center gap-2 2xl:mb-3">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            className="text-gray-400 2xl:h-5 2xl:w-5"
          >
            <path
              d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"
              fill="currentColor"
            />
          </svg>
          <span className="text-sm font-medium text-gray-600 2xl:text-lg font-sans">Communication Style</span>
        </div>
        <p className="pl-6 text-sm text-gray-500 2xl:text-lg 2xl:pl-7 font-sans">{communicationStyle}</p>
      </div>
    </button>
  );
}
