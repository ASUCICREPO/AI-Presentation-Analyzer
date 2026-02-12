'use client';

import React, { useState, useEffect } from 'react';
import { DEFAULT_METRIC_WEIGHTS } from '../config/config';

interface MetricWeights {
  wpm: number;
  eyeContact: number;
  fillerWords: number;
  volume: number;
}

interface PersonaWeightSlidersProps {
  initialWeights?: MetricWeights;
  onChange: (weights: MetricWeights) => void;
}

export default function PersonaWeightSliders({ initialWeights, onChange }: PersonaWeightSlidersProps) {
  const [weights, setWeights] = useState<MetricWeights>(
    initialWeights || DEFAULT_METRIC_WEIGHTS
  );

  // Normalize weights to ensure they sum to 1.0
  const normalizeWeights = (newWeights: MetricWeights): MetricWeights => {
    const total = newWeights.wpm + newWeights.eyeContact + newWeights.fillerWords + newWeights.volume;

    if (total === 0) {
      return DEFAULT_METRIC_WEIGHTS;
    }

    return {
      wpm: newWeights.wpm / total,
      eyeContact: newWeights.eyeContact / total,
      fillerWords: newWeights.fillerWords / total,
      volume: newWeights.volume / total,
    };
  };

  const handleWeightChange = (metric: keyof MetricWeights, value: number) => {
    const newValue = value / 100; // Convert percentage to 0-1 range

    // Calculate how much other weights need to adjust
    const otherMetrics = (['wpm', 'eyeContact', 'fillerWords', 'volume'] as const).filter(m => m !== metric);
    const currentSum = weights.wpm + weights.eyeContact + weights.fillerWords + weights.volume;
    const remaining = 1 - newValue;
    const currentOthersSum = currentSum - weights[metric];

    // Distribute remaining weight proportionally among other metrics
    const newWeights: MetricWeights = { ...weights, [metric]: newValue };

    if (currentOthersSum > 0) {
      otherMetrics.forEach(m => {
        newWeights[m] = (weights[m] / currentOthersSum) * remaining;
      });
    } else {
      // If all other weights were 0, distribute evenly
      const evenSplit = remaining / otherMetrics.length;
      otherMetrics.forEach(m => {
        newWeights[m] = evenSplit;
      });
    }

    // Normalize to handle floating point errors
    const normalized = normalizeWeights(newWeights);
    setWeights(normalized);
    onChange(normalized);
  };

  useEffect(() => {
    if (initialWeights) {
      const normalized = normalizeWeights(initialWeights);
      setWeights(normalized);
    }
  }, [initialWeights]);

  const toPercentage = (value: number) => Math.round(value * 100);

  return (
    <div className="space-y-6">
      <div className="text-sm text-gray-600 mb-4">
        Adjust the importance of each metric in the engagement score calculation. The weights automatically adjust to total 100%.
      </div>

      {/* WPM Weight */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="font-medium text-gray-700">Speaking Pace (WPM)</label>
          <span className="text-sm font-semibold text-blue-600">{toPercentage(weights.wpm)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={toPercentage(weights.wpm)}
          onChange={(e) => handleWeightChange('wpm', parseInt(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
        />
        <p className="text-xs text-gray-500 mt-1">How much weight to give to speaking pace in the overall score</p>
      </div>

      {/* Eye Contact Weight */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="font-medium text-gray-700">Eye Contact</label>
          <span className="text-sm font-semibold text-green-600">{toPercentage(weights.eyeContact)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={toPercentage(weights.eyeContact)}
          onChange={(e) => handleWeightChange('eyeContact', parseInt(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"
        />
        <p className="text-xs text-gray-500 mt-1">How much weight to give to eye contact in the overall score</p>
      </div>

      {/* Filler Words Weight */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="font-medium text-gray-700">Filler Words</label>
          <span className="text-sm font-semibold text-orange-600">{toPercentage(weights.fillerWords)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={toPercentage(weights.fillerWords)}
          onChange={(e) => handleWeightChange('fillerWords', parseInt(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-orange-600"
        />
        <p className="text-xs text-gray-500 mt-1">How much weight to give to filler word usage in the overall score</p>
      </div>

      {/* Volume Weight */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="font-medium text-gray-700">Volume & Clarity</label>
          <span className="text-sm font-semibold text-purple-600">{toPercentage(weights.volume)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={toPercentage(weights.volume)}
          onChange={(e) => handleWeightChange('volume', parseInt(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
        />
        <p className="text-xs text-gray-500 mt-1">How much weight to give to volume and clarity in the overall score</p>
      </div>

      {/* Visual Summary */}
      <div className="mt-6 p-4 bg-gray-50 rounded-lg">
        <div className="text-sm font-medium text-gray-700 mb-2">Weight Distribution</div>
        <div className="flex h-4 rounded-full overflow-hidden">
          <div
            className="bg-blue-500"
            style={{ width: `${toPercentage(weights.wpm)}%` }}
            title={`WPM: ${toPercentage(weights.wpm)}%`}
          />
          <div
            className="bg-green-500"
            style={{ width: `${toPercentage(weights.eyeContact)}%` }}
            title={`Eye Contact: ${toPercentage(weights.eyeContact)}%`}
          />
          <div
            className="bg-orange-500"
            style={{ width: `${toPercentage(weights.fillerWords)}%` }}
            title={`Filler Words: ${toPercentage(weights.fillerWords)}%`}
          />
          <div
            className="bg-purple-500"
            style={{ width: `${toPercentage(weights.volume)}%` }}
            title={`Volume: ${toPercentage(weights.volume)}%`}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-600 mt-2">
          <span>WPM</span>
          <span>Eye</span>
          <span>Filler</span>
          <span>Volume</span>
        </div>
      </div>
    </div>
  );
}
