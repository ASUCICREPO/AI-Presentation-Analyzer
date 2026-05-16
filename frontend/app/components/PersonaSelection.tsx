'use client';

import React, { useEffect, useState } from 'react';
import PersonaCard from './PersonaCard';
import CustomizePersona from './CustomizePersona';
import SessionBaselineSliders from './SessionBaselineSliders';
import {
  Persona,
  EXPERTISE_ORDER,
  PersonaBestPractices,
  DEFAULT_BEST_PRACTICES,
} from '../config/config';
import { fetchPersonas, savePersonaCustomization } from '../services/api';

interface PersonaSelectionProps {
  selectedPersona: string | null;
  onSelectPersona: (id: string | null) => void;
  onPersonaNameChange: (name: string) => void;
  onTimeLimitChange: (sec: number | undefined) => void;
  onQATimeLimitChange: (sec: number | undefined) => void;
  onPersonaDataChange: (persona: Persona | null) => void;
  customNotes: string;
  onCustomNotesChange: (notes: string) => void;
  baselineOverride: Partial<PersonaBestPractices> | null;
  onBaselineOverrideChange: (next: Partial<PersonaBestPractices> | null) => void;
  realtimeFeedbackDefault: boolean;
  onRealtimeFeedbackDefaultChange: (next: boolean) => void;
  sessionId: string;
  onContinue: () => void;
}

function PersonaCardSkeleton() {
  return (
    <div className="w-full animate-pulse rounded-2xl border-2 border-gray-200 bg-white">
      <div className="flex items-center gap-4 px-5 py-5 sm:px-6 2xl:gap-6 2xl:px-10 2xl:py-7">
        <div className="h-12 w-12 shrink-0 rounded-xl bg-gray-200 2xl:h-16 2xl:w-16" />
        <div className="flex-1">
          <div className="flex items-center gap-2.5">
            <div className="h-5 w-32 rounded bg-gray-200 2xl:h-7 2xl:w-44" />
            <div className="h-5 w-20 rounded-full bg-gray-100 2xl:h-6 2xl:w-24" />
          </div>
          <div className="mt-2 h-4 w-56 rounded bg-gray-100 2xl:h-5 2xl:w-72" />
        </div>
        <div className="hidden items-center gap-3 sm:flex">
          <div className="h-8 w-24 rounded-full bg-gray-100 2xl:h-10 2xl:w-32" />
          <div className="h-7 w-7 rounded-full border-2 border-gray-200 2xl:h-9 2xl:w-9" />
        </div>
      </div>
    </div>
  );
}

function sortByExpertise(personas: Persona[]): Persona[] {
  return [...personas].sort((a, b) => {
    const aOrder = EXPERTISE_ORDER[a.expertise.toLowerCase()] ?? 1;
    const bOrder = EXPERTISE_ORDER[b.expertise.toLowerCase()] ?? 1;
    return aOrder - bOrder;
  });
}

function resolveDefaults(persona: Persona | null): PersonaBestPractices {
  if (!persona?.bestPractices) return DEFAULT_BEST_PRACTICES;
  return { ...DEFAULT_BEST_PRACTICES, ...persona.bestPractices };
}

// ─── Realtime Feedback toggle row ─────────────────────────────────────

interface RealtimeToggleProps {
  value: boolean;
  onChange: (next: boolean) => void;
}

function RealtimeFeedbackToggle({ value, onChange }: RealtimeToggleProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 2xl:px-8 2xl:py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-medium text-gray-700 2xl:text-xl">
            Show Real-time Feedback During Practice
          </h4>
          <p className="mt-0.5 text-xs text-gray-500 2xl:text-sm">
            You can still flip this on or off during the session.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(!value)}
          role="switch"
          aria-checked={value}
          aria-label="Show real-time feedback during practice"
          className={`
            relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 2xl:h-7 2xl:w-13
            ${value ? 'bg-maroon' : 'bg-gray-300'}
          `}
        >
          <span
            className={`
              inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 2xl:h-5 2xl:w-5
              ${value ? 'translate-x-6 2xl:translate-x-7' : 'translate-x-1'}
            `}
          />
        </button>
      </div>
    </div>
  );
}

export default function PersonaSelection({
  selectedPersona,
  onSelectPersona,
  onPersonaNameChange,
  onTimeLimitChange,
  onQATimeLimitChange,
  onPersonaDataChange,
  customNotes,
  onCustomNotesChange,
  baselineOverride,
  onBaselineOverrideChange,
  realtimeFeedbackDefault,
  onRealtimeFeedbackDefaultChange,
  sessionId,
  onContinue,
}: PersonaSelectionProps) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetchPersonas()
      .then((data) => setPersonas(sortByExpertise(data)))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const isPersonaSelected = selectedPersona !== null;

  const handleContinue = async () => {
    if (!selectedPersona) return;
    const hasNotes = customNotes.trim().length > 0;
    if (hasNotes) {
      setSaving(true);
      setSaveError(null);
      try {
        const result = await savePersonaCustomization(sessionId, customNotes.trim());
        if (result.rejected) {
          setSaveError('Your notes were flagged as inappropriate. Please revise and try again.');
          setSaving(false);
          return;
        }
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save notes');
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    onContinue();
  };

  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col px-4 py-6 sm:px-6 sm:py-8 xl:max-w-[920px] 2xl:max-w-[1280px] 2xl:py-16">
      {/* Page Title */}
      <div className="mb-8 2xl:mb-12">
        <h1 className="text-xl font-bold text-gray-900 font-serif italic sm:text-2xl 2xl:text-4xl">
          Select Your Audience Persona
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-500 sm:mt-2.5 2xl:text-xl 2xl:leading-8 font-sans">
          Choose the type of audience you&apos;ll be presenting to. The AI will tailor feedback based on the selected persona&apos;s characteristics and expectations.
        </p>
      </div>

      {/* Persona Cards */}
      <div className="mb-6 2xl:mb-8 space-y-3 2xl:space-y-4">
        {loading ? (
          <>
            <PersonaCardSkeleton />
            <PersonaCardSkeleton />
            <PersonaCardSkeleton />
          </>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600 font-sans">
            Failed to load personas. Please try again.
          </div>
        ) : (
          personas.map((persona) => {
            const isThisSelected = selectedPersona === persona.personaID;
            const defaults = resolveDefaults(persona);
            return (
              <PersonaCard
                key={persona.personaID}
                name={persona.name}
                description={persona.description}
                icon={persona.icon}
                expertise={persona.expertise}
                keyPriorities={persona.keyPriorities}
                presentationTime={persona.presentationTime}
                communicationStyle={persona.communicationStyle}
                isSelected={isThisSelected}
                onSelect={() => {
                  const isDeselecting = isThisSelected;
                  onSelectPersona(isDeselecting ? null : persona.personaID);
                  onPersonaNameChange(isDeselecting ? '' : persona.name);
                  onTimeLimitChange(isDeselecting ? undefined : persona.timeLimitSec);
                  onQATimeLimitChange(isDeselecting ? undefined : persona.qaTimeLimitSec);
                  onPersonaDataChange(isDeselecting ? null : persona);
                }}
                expandedExtra={
                  isThisSelected ? (
                    <>
                      <CustomizePersona
                        value={customNotes}
                        onChange={onCustomNotesChange}
                        isVisible={true}
                        nested
                      />
                      <SessionBaselineSliders
                        defaults={defaults}
                        value={baselineOverride}
                        onChange={onBaselineOverrideChange}
                      />
                      <RealtimeFeedbackToggle
                        value={realtimeFeedbackDefault}
                        onChange={onRealtimeFeedbackDefaultChange}
                      />
                    </>
                  ) : undefined
                }
              />
            );
          })
        )}
      </div>

      {/* Continue Button - Only visible when persona is selected */}
      <div
        className={`
          flex flex-col items-end gap-2 transition-all duration-[400ms] ease-out
          ${isPersonaSelected
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-2 pointer-events-none'
          }
        `}
      >
        {saveError && (
          <p className="text-sm text-red-500 font-sans">{saveError}</p>
        )}
        <button
          onClick={handleContinue}
          disabled={saving}
          className={`
            group flex items-center gap-2 rounded-lg bg-maroon px-5 py-2.5 
            text-sm font-medium text-white shadow-sm font-sans
            transition-all duration-200 ease-out
            hover:bg-maroon-dark hover:shadow-md
            active:scale-[0.98]
            disabled:opacity-80 disabled:cursor-wait
            2xl:px-8 2xl:py-4 2xl:text-lg 2xl:rounded-xl
          `}
        >
          {saving ? (
            <>
              <svg className="h-4 w-4 animate-spin 2xl:h-5 2xl:w-5" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
              </svg>
              Saving Notes…
            </>
          ) : (
            <>
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
            </>
          )}
        </button>
      </div>
    </div>
  );
}
