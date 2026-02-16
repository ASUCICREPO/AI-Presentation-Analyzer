'use client';

import React, { useEffect, useState } from 'react';
import PersonaCard from './PersonaCard';
import CustomizePersona from './CustomizePersona';
import { Persona } from '../config/config';
import { fetchPersonas } from '../services/api';

interface PersonaSelectionProps {
  selectedPersona: string | null;
  onSelectPersona: (id: string | null) => void;
  onPersonaNameChange: (name: string) => void;
  onTimeLimitChange: (sec: number | undefined) => void;
  customNotes: string;
  onCustomNotesChange: (notes: string) => void;
  sessionId: string;
  onContinue: () => void;
}

// ─── Skeleton loader that mirrors PersonaCard layout ─────────────────
function PersonaCardSkeleton() {
  return (
    <div className="w-full animate-pulse rounded-xl border-2 border-gray-200 bg-white p-5 sm:p-6 2xl:p-10">
      {/* Header */}
      <div className="mb-4 flex items-center gap-4 2xl:mb-8 2xl:gap-6">
        <div className="h-10 w-10 rounded-lg bg-gray-200 2xl:h-14 2xl:w-14" />
        <div className="flex-1">
          <div className="h-5 w-40 rounded bg-gray-200 2xl:h-7 2xl:w-56" />
          <div className="mt-2 h-4 w-28 rounded bg-gray-100 2xl:h-5 2xl:w-36" />
        </div>
      </div>
      {/* Content grid */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-4 2xl:gap-x-12 2xl:gap-y-8">
        <div>
          <div className="mb-2 h-4 w-24 rounded bg-gray-200 2xl:h-5" />
          <div className="space-y-2 pl-6">
            <div className="h-3 w-32 rounded bg-gray-100 2xl:h-4" />
            <div className="h-3 w-28 rounded bg-gray-100 2xl:h-4" />
            <div className="h-3 w-36 rounded bg-gray-100 2xl:h-4" />
          </div>
        </div>
        <div>
          <div className="mb-2 h-4 w-24 rounded bg-gray-200 2xl:h-5" />
          <div className="h-3 w-28 rounded bg-gray-100 pl-6 2xl:h-4" />
        </div>
      </div>
      {/* Communication style */}
      <div className="mt-4 2xl:mt-8">
        <div className="mb-2 h-4 w-36 rounded bg-gray-200 2xl:h-5" />
        <div className="h-3 w-full max-w-md rounded bg-gray-100 pl-6 2xl:h-4" />
      </div>
    </div>
  );
}

export default function PersonaSelection({
  selectedPersona,
  onSelectPersona,
  onPersonaNameChange,
  onTimeLimitChange,
  customNotes,
  onCustomNotesChange,
  sessionId,
  onContinue,
}: PersonaSelectionProps) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPersonas()
      .then(setPersonas)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const isPersonaSelected = selectedPersona !== null;

  return (
    <div className="mx-auto w-full max-w-[800px] px-4 py-6 sm:px-6 sm:py-8 xl:max-w-[900px] 2xl:max-w-[1280px] 2xl:py-16">
      {/* Page Title */}
      <div className="mb-6 2xl:mb-10">
        <h1 className="text-xl font-bold text-gray-900 font-serif italic sm:text-2xl 2xl:text-4xl">
          Select Your Audience Persona
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-500 sm:mt-2 2xl:text-xl 2xl:leading-8 font-sans">
          Choose the type of audience you&apos;ll be presenting to. The AI will tailor feedback based on the selected persona&apos;s characteristics and expectations.
        </p>
      </div>

      {/* Persona Cards */}
      <div className="mb-6 2xl:mb-8 space-y-4">
        {loading ? (
          <>
            <PersonaCardSkeleton />
          </>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600 font-sans">
            Failed to load personas. Please try again.
          </div>
        ) : (
          personas.map((persona) => (
            <PersonaCard
              key={persona.personaID}
              name={persona.name}
              expertise={persona.expertise}
              keyPriorities={persona.keyPriorities}
              attentionSpan={persona.attentionSpan}
              communicationStyle={persona.communicationStyle}
              isSelected={selectedPersona === persona.personaID}
              onSelect={() => {
                const isDeselecting = selectedPersona === persona.personaID;
                onSelectPersona(isDeselecting ? null : persona.personaID);
                onPersonaNameChange(isDeselecting ? '' : persona.name);
                onTimeLimitChange(isDeselecting ? undefined : persona.timeLimitSec);
              }}
            />
          ))
        )}
      </div>

      {/* Customize Persona - Only visible when persona is selected */}
      <div
        className={`
          transition-all duration-400 ease-out overflow-hidden
          ${isPersonaSelected 
            ? 'opacity-100 max-h-[500px] mb-6 2xl:mb-8' 
            : 'opacity-0 max-h-0 mb-0'
          }
        `}
      >
        <CustomizePersona
          value={customNotes}
          onChange={onCustomNotesChange}
          sessionId={sessionId}
          isVisible={isPersonaSelected}
        />
      </div>

      {/* Continue Button - Only visible when persona is selected */}
      <div
        className={`
          flex justify-end transition-all duration-400 ease-out
          ${isPersonaSelected 
            ? 'opacity-100 translate-y-0' 
            : 'opacity-0 translate-y-2 pointer-events-none'
          }
        `}
      >
        <button
          onClick={onContinue}
          className="
            group flex items-center gap-2 rounded-lg bg-maroon px-5 py-2.5 
            text-sm font-medium text-white shadow-sm font-sans
            transition-all duration-200 ease-out
            hover:bg-maroon-dark hover:shadow-md
            active:scale-[0.98]
            2xl:px-8 2xl:py-4 2xl:text-lg 2xl:rounded-xl
          "
        >
          Continue to Content Upload
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            className="transition-transform duration-200 group-hover:translate-x-0.5 2xl:h-6 2xl:w-6"
          >
            <path
              d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
