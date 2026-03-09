'use client';

import React, { useRef, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_PERSONA_ICON } from '../config/config';

// =============================================================================
// Accent colors — keyed by expertise level
// =============================================================================

export interface PersonaAccent {
  bgHover: string;
  bgSelected: string;
  border: string;
  iconBg: string;
  iconColor: string;
  pill: string;
  pillText: string;
}

export const PERSONA_ACCENTS: Record<string, PersonaAccent> = {
  beginner: {
    bgHover: 'hover:bg-sky-50/40',
    bgSelected: 'bg-sky-50/30',
    border: 'border-sky-400',
    iconBg: 'bg-sky-100',
    iconColor: 'text-sky-700',
    pill: 'bg-sky-100',
    pillText: 'text-sky-700',
  },
  intermediate: {
    bgHover: 'hover:bg-amber-50/40',
    bgSelected: 'bg-amber-50/30',
    border: 'border-amber-400',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-700',
    pill: 'bg-amber-100',
    pillText: 'text-amber-700',
  },
  expert: {
    bgHover: 'hover:bg-violet-50/40',
    bgSelected: 'bg-violet-50/30',
    border: 'border-violet-400',
    iconBg: 'bg-violet-100',
    iconColor: 'text-violet-700',
    pill: 'bg-violet-100',
    pillText: 'text-violet-700',
  },
};

const DEFAULT_ACCENT: PersonaAccent = PERSONA_ACCENTS.intermediate;

function getAccent(expertise: string): PersonaAccent {
  const key = expertise.toLowerCase();
  return PERSONA_ACCENTS[key] ?? DEFAULT_ACCENT;
}

// =============================================================================
// Icon registry
//
// Source: Google Material Symbols (Outlined, 24px grid)
// https://fonts.google.com/icons
//
// Each SVG path below is taken directly from the Material Symbols icon set.
// To add a new icon:
//   1. Search https://fonts.google.com/icons for the icon name
//   2. Download the SVG or copy the <path d="..."> from the source
//   3. Add an entry to ICON_REGISTRY below using the icon's lowercase name
//   4. Store that name in the persona's `icon` field in DynamoDB
//
// The `icon` field on each persona in the DynamoDB table should match a key
// in this registry. If it doesn't match (or is missing), DEFAULT_PERSONA_ICON
// from config.ts is used ("people").
// =============================================================================

type IconSvg = (props: { className?: string }) => ReactNode;

const ICON_REGISTRY: Record<string, IconSvg> = {
  briefcase: ({ className }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M20 7h-4V5c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zM10 5h4v2h-4V5zm10 15H4v-7h4v1c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-1h4v7zm0-9h-4v-1c0-.55-.45-1-1-1H9c-.55 0-1 .45-1 1v1H4V9h16v2z" fill="currentColor" />
    </svg>
  ),
  people: ({ className }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 13.75c-2.34 0-7 1.17-7 3.5V19h14v-1.75c0-2.33-4.66-3.5-7-3.5zM4.34 17c.84-.58 2.87-1.25 4.66-1.25s3.82.67 4.66 1.25H4.34zM9 12c1.93 0 3.5-1.57 3.5-3.5S10.93 5 9 5 5.5 6.57 5.5 8.5 7.07 12 9 12zm0-5c.83 0 1.5.67 1.5 1.5S9.83 10 9 10s-1.5-.67-1.5-1.5S8.17 7 9 7zm7.04 6.81c1.16.84 1.96 1.96 1.96 3.44V19h4v-1.75c0-2.02-3.5-3.17-5.96-3.44zM15 12c1.93 0 3.5-1.57 3.5-3.5S16.93 5 15 5c-.54 0-1.04.13-1.5.35.63.89 1 1.98 1 3.15s-.37 2.26-1 3.15c.46.22.96.35 1.5.35z" fill="currentColor" />
    </svg>
  ),
  school: ({ className }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z" fill="currentColor" />
    </svg>
  ),
  mic: ({ className }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" fill="currentColor" />
    </svg>
  ),
  lightbulb: ({ className }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1-.85.6V16h-4v-2.3l-.85-.6A4.997 4.997 0 0 1 7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.63-.8 3.16-2.15 4.1z" fill="currentColor" />
    </svg>
  ),
  podium: ({ className }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z" fill="currentColor" />
    </svg>
  ),
  handshake: ({ className }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12.22 19.85c-.18.18-.5.21-.71 0L5.04 14.5a.996.996 0 0 1 0-1.41l5.66-5.66a.996.996 0 0 1 1.41 0l2.12 2.12-3.18 3.18 1.41 1.41 3.18-3.18 1.06 1.06-3.18 3.18 1.41 1.41 3.18-3.18.71.71-3.18 3.18 1.41 1.41 3.18-3.18.35.36c.39.39.39 1.02 0 1.41l-4.36 4.36c-.18.18-.43.29-.71.29-.26 0-.51-.1-.71-.29z" fill="currentColor" />
    </svg>
  ),
  science: ({ className }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M13 11.33 18 18H6l5-6.67V6h2v5.33M15.96 4H8.04C7.62 4 7.39 4.48 7.65 4.81L9 6.5v4.17L3.2 18.4C2.71 19.06 3.18 20 4 20h16c.82 0 1.29-.94.8-1.6L15 10.67V6.5l1.35-1.69C16.61 4.48 16.38 4 15.96 4z" fill="currentColor" />
    </svg>
  ),
};

function getIconComponent(iconName: string | undefined): IconSvg {
  const name = (iconName ?? DEFAULT_PERSONA_ICON).toLowerCase();
  return ICON_REGISTRY[name] ?? ICON_REGISTRY[DEFAULT_PERSONA_ICON] ?? ICON_REGISTRY.people;
}

// =============================================================================
// PersonaCard component
// =============================================================================

interface PersonaCardProps {
  name: string;
  description: string;
  icon?: string;
  expertise: string;
  keyPriorities: string[];
  presentationTime: string;
  communicationStyle: string;
  isSelected: boolean;
  onSelect: () => void;
}

export default function PersonaCard({
  name,
  description,
  icon,
  expertise,
  keyPriorities,
  presentationTime,
  communicationStyle,
  isSelected,
  onSelect,
}: PersonaCardProps) {
  const detailsRef = useRef<HTMLDivElement>(null);
  const [detailsHeight, setDetailsHeight] = useState(0);
  const accent = getAccent(expertise);
  const IconComponent = getIconComponent(icon);

  useEffect(() => {
    if (detailsRef.current) {
      setDetailsHeight(detailsRef.current.scrollHeight);
    }
  }, [isSelected, keyPriorities, communicationStyle]);

  return (
    <button
      onClick={onSelect}
      className={`
        group relative w-full rounded-2xl border-2 text-left
        transition-all duration-300 ease-out
        ${isSelected
          ? `${accent.bgSelected} ${accent.border} shadow-md ring-1 ring-black/[0.03]`
          : `bg-white border-gray-200 ${accent.bgHover} hover:border-gray-300 hover:shadow-sm`
        }
      `}
    >
      {/* Compact Header */}
      <div className="flex items-center gap-4 px-5 py-5 sm:px-6 2xl:gap-6 2xl:px-10 2xl:py-7">
        {/* Icon from registry */}
        <div
          className={`
            flex h-12 w-12 shrink-0 items-center justify-center rounded-xl 2xl:h-16 2xl:w-16 2xl:rounded-2xl
            transition-all duration-300 ${accent.iconBg}
          `}
        >
          <IconComponent className={`2xl:h-8 2xl:w-8 ${accent.iconColor}`} />
        </div>

        {/* Text content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <h3 className="text-base font-semibold text-gray-900 font-serif 2xl:text-2xl">{name}</h3>
            <span className={`
              inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium font-sans 2xl:text-sm 2xl:px-3 2xl:py-1
              ${isSelected ? `${accent.pill} ${accent.pillText}` : 'bg-gray-100 text-gray-500'}
              transition-colors duration-300
            `}>
              {expertise}
            </span>
          </div>
          <p className="mt-1 text-sm leading-snug text-gray-500 font-sans line-clamp-1 2xl:text-base">{description}</p>
        </div>

        {/* Right side: time + action */}
        <div className="hidden shrink-0 items-center gap-3 sm:flex 2xl:gap-4">
          <div className={`
            flex items-center gap-1.5 rounded-full px-3 py-1.5 2xl:gap-2 2xl:px-4 2xl:py-2
            transition-colors duration-300
            ${isSelected ? `${accent.pill} ${accent.pillText}` : 'bg-gray-100 text-gray-500'}
          `}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="2xl:h-5 2xl:w-5">
              <path
                d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"
                fill="currentColor"
              />
            </svg>
            <span className="text-xs font-medium font-sans 2xl:text-sm">{presentationTime}</span>
          </div>

          {/* Selection indicator */}
          <div
            className={`
              flex h-7 w-7 shrink-0 items-center justify-center rounded-full 2xl:h-9 2xl:w-9
              transition-all duration-300 ease-out
              ${isSelected ? 'bg-maroon scale-100' : 'border-2 border-gray-200 bg-white group-hover:border-gray-300'}
            `}
          >
            {isSelected && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-white 2xl:h-5 2xl:w-5">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="currentColor" />
              </svg>
            )}
          </div>
        </div>

        {/* Mobile: small selected indicator */}
        <div className="flex shrink-0 sm:hidden">
          <div
            className={`
              flex h-6 w-6 items-center justify-center rounded-full transition-all duration-300
              ${isSelected ? 'bg-maroon' : 'border-2 border-gray-200'}
            `}
          >
            {isSelected && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-white">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="currentColor" />
              </svg>
            )}
          </div>
        </div>
      </div>

      {/* "View details" hint when not selected */}
      {!isSelected && (
        <div className="flex items-center justify-center gap-1 border-t border-gray-100 px-5 py-2 text-xs font-medium text-gray-400 opacity-0 transition-opacity duration-200 group-hover:opacity-100 font-sans 2xl:py-2.5 2xl:text-sm">
          Click to view details
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="2xl:h-4 2xl:w-4">
            <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" fill="currentColor" />
          </svg>
        </div>
      )}

      {/* Expandable Details */}
      <div
        ref={detailsRef}
        className="overflow-hidden transition-all duration-300 ease-out"
        style={{ maxHeight: isSelected ? detailsHeight : 0, opacity: isSelected ? 1 : 0 }}
      >
        <div className="border-t border-gray-200/60 px-5 pb-5 pt-4 sm:px-6 2xl:px-10 2xl:pb-8 2xl:pt-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-x-8 2xl:gap-x-12 2xl:gap-y-6">
            {/* Key Priorities */}
            <div>
              <div className="mb-2.5 flex items-center gap-2 2xl:mb-3">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-gray-400 2xl:h-5 2xl:w-5">
                  <path
                    d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"
                    fill="currentColor"
                  />
                </svg>
                <span className="text-sm font-semibold text-gray-700 font-sans 2xl:text-lg">Key Priorities</span>
              </div>
              <ul className="space-y-1.5 pl-6 2xl:space-y-2 2xl:pl-7">
                {keyPriorities.map((priority, index) => (
                  <li key={index} className="text-sm leading-snug text-gray-500 font-sans 2xl:text-base">
                    <span className="mr-1.5 text-gray-300">&#8226;</span>
                    {priority}
                  </li>
                ))}
              </ul>
            </div>

            {/* Right column: Time + Communication Style */}
            <div className="space-y-4 2xl:space-y-6">
              <div>
                <div className="mb-2.5 flex items-center gap-2 2xl:mb-3">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-gray-400 2xl:h-5 2xl:w-5">
                    <path
                      d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"
                      fill="currentColor"
                    />
                  </svg>
                  <span className="text-sm font-semibold text-gray-700 font-sans 2xl:text-lg">Presentation Time</span>
                </div>
                <p className="pl-6 text-sm text-gray-500 font-sans 2xl:pl-7 2xl:text-base">Up to {presentationTime}</p>
              </div>

              <div>
                <div className="mb-2.5 flex items-center gap-2 2xl:mb-3">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-gray-400 2xl:h-5 2xl:w-5">
                    <path
                      d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"
                      fill="currentColor"
                    />
                  </svg>
                  <span className="text-sm font-semibold text-gray-700 font-sans 2xl:text-lg">Communication Style</span>
                </div>
                <p className="pl-6 text-sm text-gray-500 font-sans 2xl:pl-7 2xl:text-base">{communicationStyle}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}
