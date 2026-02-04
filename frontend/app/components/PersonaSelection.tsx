'use client';

import React from 'react';
import PersonaCard from './PersonaCard';
import ComingSoonBox from './ComingSoonBox';
import CustomizePersona from './CustomizePersona';
import { ACADEMIC_PERSONA, COMING_SOON_PERSONAS } from '../config/personas';

interface PersonaSelectionProps {
  selectedPersona: string | null;
  onSelectPersona: (id: string | null) => void;
  customNotes: string;
  onCustomNotesChange: (notes: string) => void;
  onContinue: () => void;
}

export default function PersonaSelection({
  selectedPersona,
  onSelectPersona,
  customNotes,
  onCustomNotesChange,
  onContinue,
}: PersonaSelectionProps) {
  const isPersonaSelected = selectedPersona === ACADEMIC_PERSONA.id;

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

      {/* Persona Card */}
      <div className="mb-6 2xl:mb-8">
        <PersonaCard
          {...ACADEMIC_PERSONA}
          isSelected={isPersonaSelected}
          onSelect={() => onSelectPersona(isPersonaSelected ? null : ACADEMIC_PERSONA.id)}
        />
      </div>

      {/* Coming Soon Box */}
      <div className="mb-6 2xl:mb-8">
        <ComingSoonBox personas={COMING_SOON_PERSONAS} />
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
