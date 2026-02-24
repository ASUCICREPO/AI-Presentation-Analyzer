'use client';

import React, { useEffect, useState } from 'react';
import { Persona, PersonaBestPractices, PersonaScoringWeights, DEFAULT_BEST_PRACTICES, DEFAULT_SCORING_WEIGHTS, medianBestPractices, medianScoringWeights } from '../config/config';

interface PersonaConfirmationProps {
    personas: Persona[];
    customNotes: string;
    onConfirm: () => void;
    onBack: () => void;
}

export default function PersonaConfirmation({
    personas,
    customNotes,
    onConfirm,
    onBack,
}: PersonaConfirmationProps) {
    const [resolvedBP, setResolvedBP] = useState<PersonaBestPractices>(DEFAULT_BEST_PRACTICES);
    const [resolvedWeights, setResolvedWeights] = useState<PersonaScoringWeights>(DEFAULT_SCORING_WEIGHTS);

    useEffect(() => {
        if (personas.length > 0) {
            setResolvedBP(medianBestPractices(personas));
            setResolvedWeights(medianScoringWeights(personas));
        }
    }, [personas]);

    const weightPercent = (val: number) => `${Math.round(val * 100)}%`;

    return (
        <div className="mx-auto w-full max-w-[800px] px-4 py-6 sm:px-6 sm:py-8 xl:max-w-[900px] 2xl:max-w-[1280px] 2xl:py-16">
            {/* Title */}
            <div className="mb-6 2xl:mb-10">
                <h1 className="text-xl font-bold text-gray-900 font-serif italic sm:text-2xl 2xl:text-4xl">
                    Review Your Session Setup
                </h1>
                <p className="mt-1.5 text-sm leading-relaxed text-gray-500 sm:mt-2 2xl:text-xl 2xl:leading-8 font-sans">
                    Confirm the persona configuration before starting your session. These settings will be used for real-time feedback and post-session analytics.
                </p>
            </div>

            {/* Selected Personas */}
            <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 sm:p-6 2xl:p-10 2xl:mb-8">
                <h2 className="mb-4 text-base font-semibold text-gray-900 font-serif 2xl:text-2xl 2xl:mb-6">
                    {personas.length === 1 ? 'Selected Persona' : `Selected Personas (${personas.length})`}
                </h2>
                <div className="space-y-4 2xl:space-y-6">
                    {personas.map((p) => (
                        <div key={p.personaID} className="flex items-start gap-4 2xl:gap-6">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-maroon/10 2xl:h-14 2xl:w-14">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-maroon 2xl:h-8 2xl:w-8">
                                    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" fill="currentColor" />
                                </svg>
                            </div>
                            <div className="min-w-0 flex-1">
                                <h3 className="text-sm font-semibold text-gray-900 font-serif 2xl:text-xl">{p.name}</h3>
                                <p className="mt-0.5 text-sm text-gray-500 font-sans 2xl:text-base">{p.description}</p>
                                <div className="mt-2 flex flex-wrap gap-2 2xl:mt-3">
                                    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600 font-sans 2xl:text-sm 2xl:px-3 2xl:py-1">
                                        {p.expertise}
                                    </span>
                                    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600 font-sans 2xl:text-sm 2xl:px-3 2xl:py-1">
                                        {p.communicationStyle}
                                    </span>
                                    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600 font-sans 2xl:text-sm 2xl:px-3 2xl:py-1">
                                        {p.attentionSpan}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Resolved Thresholds */}
            <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 sm:p-6 2xl:p-10 2xl:mb-8">
                <h2 className="mb-4 text-base font-semibold text-gray-900 font-serif 2xl:text-2xl 2xl:mb-6">
                    Best Practices
                </h2>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 2xl:gap-6">
                    <ThresholdCard
                        label="Speaking Pace"
                        value={`${resolvedBP.wpm.min}–${resolvedBP.wpm.max}`}
                        unit="wpm"
                    />
                    <ThresholdCard
                        label="Eye Contact"
                        value={`≥ ${resolvedBP.eyeContact.min}`}
                        unit="%"
                    />
                    <ThresholdCard
                        label="Filler Words"
                        value={`≤ ${resolvedBP.fillerWords.max}`}
                        unit="per 30s"
                    />
                    <ThresholdCard
                        label="Pauses"
                        value={`≥ ${resolvedBP.pauses.min}`}
                        unit="per 30s"
                    />
                </div>
            </div>

            {/* Scoring Weights */}
            <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 sm:p-6 2xl:p-10 2xl:mb-8">
                <h2 className="mb-4 text-base font-semibold text-gray-900 font-serif 2xl:text-2xl 2xl:mb-6">
                    Scoring Weights
                </h2>
                <div className="space-y-3 2xl:space-y-4">
                    <WeightBar label="Pace" value={resolvedWeights.pace} display={weightPercent(resolvedWeights.pace)} />
                    <WeightBar label="Eye Contact" value={resolvedWeights.eyeContact} display={weightPercent(resolvedWeights.eyeContact)} />
                    <WeightBar label="Filler Words" value={resolvedWeights.fillerWords} display={weightPercent(resolvedWeights.fillerWords)} />
                    <WeightBar label="Pauses" value={resolvedWeights.pauses} display={weightPercent(resolvedWeights.pauses)} />
                </div>
            </div>

            {/* Custom Notes (if any) */}
            {customNotes.trim() && (
                <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 sm:p-6 2xl:p-10 2xl:mb-8">
                    <h2 className="mb-3 text-base font-semibold text-gray-900 font-serif 2xl:text-2xl 2xl:mb-4">
                        Custom Notes
                    </h2>
                    <p className="text-sm text-gray-600 font-sans whitespace-pre-wrap 2xl:text-base">{customNotes.trim()}</p>
                </div>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between">
                <button
                    onClick={onBack}
                    className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 font-sans 2xl:px-6 2xl:py-3.5 2xl:text-lg"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="2xl:h-5 2xl:w-5">
                        <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z" fill="currentColor" />
                    </svg>
                    Back to Persona Selection
                </button>
                <button
                    onClick={onConfirm}
                    className="group flex items-center gap-2 rounded-lg bg-maroon px-5 py-2.5 text-sm font-medium text-white shadow-sm font-sans transition-all duration-200 ease-out hover:bg-maroon-dark hover:shadow-md active:scale-[0.98] 2xl:px-8 2xl:py-4 2xl:text-lg 2xl:rounded-xl"
                >
                    Continue to Content Upload
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="transition-transform duration-200 group-hover:translate-x-0.5 2xl:h-6 2xl:w-6">
                        <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" fill="currentColor" />
                    </svg>
                </button>
            </div>
        </div>
    );
}

function ThresholdCard({ label, value, unit }: { label: string; value: string; unit: string }) {
    return (
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 2xl:p-5">
            <p className="text-xs text-gray-500 font-sans 2xl:text-sm">{label}</p>
            <p className="mt-1 text-lg font-semibold text-gray-900 font-sans 2xl:text-2xl">
                {value}
                <span className="ml-1 text-xs font-normal text-gray-400 2xl:text-sm">{unit}</span>
            </p>
        </div>
    );
}

function WeightBar({ label, value, display }: { label: string; value: number; display: string }) {
    return (
        <div className="flex items-center gap-3 2xl:gap-4">
            <span className="w-24 shrink-0 text-sm text-gray-600 font-sans 2xl:w-32 2xl:text-base">{label}</span>
            <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden 2xl:h-3">
                <div
                    className="h-full rounded-full bg-maroon transition-all duration-500"
                    style={{ width: `${Math.round(value * 100)}%` }}
                />
            </div>
            <span className="w-10 text-right text-sm font-medium text-gray-700 font-sans 2xl:w-14 2xl:text-base">{display}</span>
        </div>
    );
}
