'use client';

import React from 'react';
import { VocalVarietyMetrics } from '@/app/hooks/useVocalVariety';

interface VocalVarietyPanelProps {
    metrics: VocalVarietyMetrics;
}

export function VocalVarietyPanel({ metrics }: VocalVarietyPanelProps) {
    const getVarietyColor = (score: number) => {
        if (score >= 70) return 'text-green-600';
        if (score >= 40) return 'text-yellow-600';
        return 'text-red-600';
    };

    const getMonotoneColor = (score: number) => {
        if (score >= 70) return 'text-red-600';
        if (score >= 40) return 'text-yellow-600';
        return 'text-green-600';
    };

    return (
        <div className="bg-white rounded-lg shadow p-4 space-y-3">
            <h3 className="font-semibold text-gray-800 mb-3">Vocal Variety</h3>

            {/* Pitch Variation */}
            <div className="space-y-1">
                <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Pitch Variation</span>
                    <span className={`text-sm font-semibold ${getVarietyColor(metrics.pitchVariation)}`}>
                        {metrics.pitchVariation}%
                    </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                        className={`h-2 rounded-full transition-all duration-300 ${metrics.pitchVariation >= 70 ? 'bg-green-500' :
                            metrics.pitchVariation >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                        style={{ width: `${metrics.pitchVariation}%` }}
                    />
                </div>
            </div>

            {/* Volume Variation */}
            <div className="space-y-1">
                <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Volume Variation</span>
                    <span className={`text-sm font-semibold ${getVarietyColor(metrics.volumeVariation)}`}>
                        {metrics.volumeVariation}%
                    </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                        className={`h-2 rounded-full transition-all duration-300 ${metrics.volumeVariation >= 70 ? 'bg-green-500' :
                            metrics.volumeVariation >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                        style={{ width: `${metrics.volumeVariation}%` }}
                    />
                </div>
            </div>

            {/* Spectral Variation (Tone) */}
            <div className="space-y-1">
                <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Tone Variation</span>
                    <span className={`text-sm font-semibold ${getVarietyColor(metrics.spectralVariation)}`}>
                        {metrics.spectralVariation}%
                    </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                        className={`h-2 rounded-full transition-all duration-300 ${metrics.spectralVariation >= 70 ? 'bg-green-500' :
                            metrics.spectralVariation >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                        style={{ width: `${metrics.spectralVariation}%` }}
                    />
                </div>
            </div>

            {/* Monotone Score */}
            <div className="pt-2 border-t border-gray-200">
                <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Monotone Level</span>
                    <span className={`text-sm font-semibold ${getMonotoneColor(metrics.monotoneScore)}`}>
                        {metrics.monotoneScore}%
                    </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                    {metrics.monotoneScore >= 70 && 'Try varying your pitch and volume more'}
                    {metrics.monotoneScore >= 40 && metrics.monotoneScore < 70 && 'Good variety, keep it up'}
                    {metrics.monotoneScore < 40 && 'Excellent vocal variety!'}
                </p>
            </div>
        </div>
    );
}
