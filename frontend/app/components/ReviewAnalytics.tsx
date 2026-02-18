'use client';

import React, { useState } from 'react';
import { SessionAnalytics } from '../hooks/useSessionAnalytics';
import { AIFeedbackResponse } from '../services/api';
import {
  Download,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';

interface ReviewAnalyticsProps {
  sessionData: SessionAnalytics;
  aiFeedback: AIFeedbackResponse | null;
  onDownload: () => void;
  onBackToStart: () => void;
}

const BEST_PRACTICES: Record<string, { label: string; range: string; check: (v: number) => boolean }> = {
  wpm: { label: 'Speaking Pace', range: '130-160 wpm', check: (v) => v >= 130 && v <= 160 },
  eyeContact: { label: 'Eye Contact', range: '70%+', check: (v) => v >= 70 },
  fillers: { label: 'Filler Words', range: '5 or fewer', check: (v) => v <= 5 },
  pauses: { label: 'Strategic Pauses', range: '5+ pauses', check: (v) => v >= 5 },
};

function ScoreRing({ score }: { score: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const color = score >= 80 ? '#16a34a' : score >= 60 ? '#ca8a04' : '#dc2626';

  return (
    <div className="relative h-40 w-40 flex-shrink-0">
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        <circle cx="64" cy="64" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="8" />
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${progress} ${circumference - progress}`}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold text-gray-900">{score}</span>
        <span className="text-xs text-gray-500">Overall Score</span>
      </div>
    </div>
  );
}

function MetricBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="h-2.5 w-full rounded-full bg-gray-200">
      <div className={`h-full rounded-full ${color} transition-all duration-700 ease-out`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function ReviewAnalytics({ sessionData, aiFeedback, onDownload, onBackToStart }: ReviewAnalyticsProps) {
  const { windows } = sessionData;
  const [showWindows, setShowWindows] = useState(false);
  const [dismissedBanner, setDismissedBanner] = useState(false);

  const stats = (() => {
    if (windows.length === 0) return null;
    const avgWpm = Math.round(windows.reduce((s, w) => s + w.speakingPace.average, 0) / windows.length);
    const avgVolume = Math.round(windows.reduce((s, w) => s + w.volumeLevel.average, 0) / windows.length);
    const avgEyeContact = Math.round(windows.reduce((s, w) => s + w.eyeContactScore, 0) / windows.length);
    const totalFillers = windows.reduce((s, w) => s + w.fillerWords, 0);
    const totalPauses = windows.reduce((s, w) => s + w.pauses, 0);
    return { avgWpm, avgVolume, avgEyeContact, totalFillers, totalPauses };
  })();

  const overallScore = (() => {
    if (!stats) return 0;
    const paceScore = stats.avgWpm >= 130 && stats.avgWpm <= 160 ? 100 : stats.avgWpm >= 110 && stats.avgWpm <= 180 ? 70 : 40;
    const eyeScore = Math.min(stats.avgEyeContact, 100);
    const fillerScore = stats.totalFillers <= 5 ? 100 : stats.totalFillers <= 10 ? 70 : 40;
    const pauseScore = stats.totalPauses >= 5 ? 100 : stats.totalPauses >= 2 ? 70 : 40;
    return Math.round(paceScore * 0.25 + eyeScore * 0.35 + fillerScore * 0.2 + pauseScore * 0.2);
  })();

  const getBarColor = (score: number, type: 'wpm' | 'volume' | 'eyeContact') => {
    if (type === 'wpm') return score >= 130 && score <= 160 ? 'bg-green-500' : score >= 110 && score <= 180 ? 'bg-yellow-500' : 'bg-red-500';
    if (type === 'volume') return score >= 40 && score <= 80 ? 'bg-green-500' : score >= 20 ? 'bg-yellow-500' : 'bg-red-500';
    return score >= 70 ? 'bg-green-500' : score >= 50 ? 'bg-yellow-500' : 'bg-red-500';
  };

  const getTrendIcon = (current: number, previous: number) => {
    if (current > previous) return <TrendingUp className="h-4 w-4 text-green-600" />;
    if (current < previous) return <TrendingDown className="h-4 w-4 text-red-600" />;
    return <Minus className="h-4 w-4 text-gray-400" />;
  };

  const getScoreColor = (score: number, type: 'wpm' | 'volume' | 'eyeContact') => {
    if (type === 'wpm') return score >= 120 && score <= 150 ? 'text-green-600' : score >= 100 && score <= 170 ? 'text-yellow-600' : 'text-red-600';
    if (type === 'volume') return score >= 40 && score <= 80 ? 'text-green-600' : score >= 20 ? 'text-yellow-600' : 'text-red-600';
    return score >= 80 ? 'text-green-600' : score >= 60 ? 'text-yellow-600' : 'text-red-600';
  };

  const persona = aiFeedback?.persona;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
      {/* No-AI Banner */}
      {!aiFeedback && !dismissedBanner && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            <p className="text-sm text-yellow-800">
              AI feedback could not be generated. Showing raw metrics only.
            </p>
          </div>
          <button onClick={() => setDismissedBanner(true)} className="text-yellow-600 hover:text-yellow-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Presentation Analysis</h1>
          {persona && (
            <p className="mt-1 text-sm text-gray-600">
              Feedback tailored for: <span className="font-semibold text-maroon">{persona.title}</span>
            </p>
          )}
          {!persona && (
            <p className="mt-1 text-sm text-gray-600">
              {sessionData.personaTitle} &middot; {windows.length} windows recorded
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={onDownload}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Download className="h-4 w-4" />
            Download JSON
          </button>
          <button
            onClick={onBackToStart}
            className="flex items-center gap-2 rounded-lg bg-maroon px-4 py-2 text-white hover:bg-maroon/90 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            New Practice Session
          </button>
        </div>
      </div>

      {/* Performance Summary Card */}
      {stats && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-gradient-to-r from-green-50/60 to-white p-6 shadow-sm">
          <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
            <ScoreRing score={overallScore} />
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-gray-900">Performance Summary</h2>
              {aiFeedback ? (
                <p className="mt-2 text-sm leading-relaxed text-gray-700">
                  {aiFeedback.performanceSummary.overallAssessment}
                </p>
              ) : (
                <p className="mt-2 text-sm leading-relaxed text-gray-700">
                  Session completed with {windows.length} analysis window{windows.length !== 1 ? 's' : ''}.
                  Review your detailed metrics below.
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                {BEST_PRACTICES.wpm.check(stats.avgWpm) && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Good pacing
                  </span>
                )}
                {!BEST_PRACTICES.eyeContact.check(stats.avgEyeContact) && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-800">
                    <AlertTriangle className="h-3.5 w-3.5" /> Improve eye contact
                  </span>
                )}
                {BEST_PRACTICES.fillers.check(stats.totalFillers) && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Minimal fillers
                  </span>
                )}
                {BEST_PRACTICES.pauses.check(stats.totalPauses) && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Good use of pauses
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Two-Column: Metrics + Recommendations */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Detailed Metrics */}
        {stats && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-5 text-lg font-semibold text-gray-900">Detailed Metrics</h2>
            <div className="space-y-5">
              {/* Speaking Pace */}
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700">Speaking Pace</span>
                  <span className="font-bold text-gray-900">{stats.avgWpm} wpm</span>
                </div>
                <MetricBar value={stats.avgWpm} max={200} color={getBarColor(stats.avgWpm, 'wpm')} />
                {aiFeedback && (
                  <p className="mt-1 text-xs text-gray-500">{aiFeedback.performanceSummary.deliveryFeedback.speakingPace}</p>
                )}
              </div>

              {/* Eye Contact */}
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700">Eye Contact</span>
                  <span className="font-bold text-gray-900">{stats.avgEyeContact}%</span>
                </div>
                <MetricBar value={stats.avgEyeContact} max={100} color={getBarColor(stats.avgEyeContact, 'eyeContact')} />
                {aiFeedback && (
                  <p className="mt-1 text-xs text-gray-500">{aiFeedback.performanceSummary.deliveryFeedback.eyeContact}</p>
                )}
              </div>

              {/* Volume */}
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700">Volume</span>
                  <span className="font-bold text-gray-900">{stats.avgVolume}%</span>
                </div>
                <MetricBar value={stats.avgVolume} max={100} color={getBarColor(stats.avgVolume, 'volume')} />
                {aiFeedback && (
                  <p className="mt-1 text-xs text-gray-500">{aiFeedback.performanceSummary.deliveryFeedback.volume}</p>
                )}
              </div>

              {/* Filler Words */}
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700">Filler Words</span>
                  <span className={`font-bold ${stats.totalFillers <= 5 ? 'text-green-600' : stats.totalFillers <= 10 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {stats.totalFillers} detected
                  </span>
                </div>
                {aiFeedback && (
                  <p className="mt-1 text-xs text-gray-500">{aiFeedback.performanceSummary.deliveryFeedback.fillerWords}</p>
                )}
              </div>

              {/* Strategic Pauses */}
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700">Strategic Pauses</span>
                  <span className="font-bold text-gray-900">{stats.totalPauses}</span>
                </div>
                {aiFeedback && (
                  <p className="mt-1 text-xs text-gray-500">{aiFeedback.performanceSummary.deliveryFeedback.pauses}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Key Recommendations */}
        {aiFeedback && aiFeedback.keyRecommendations.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-5 text-lg font-semibold text-gray-900">
              Key Recommendations{persona ? ` for ${persona.title}` : ''}
            </h2>
            <div className="space-y-4">
              {aiFeedback.keyRecommendations.map((rec, i) => (
                <div key={i} className="flex gap-3">
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-maroon text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">{rec.title}</h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{rec.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* If no AI feedback, show an empty placeholder in the right column */}
        {!aiFeedback && stats && (
          <div className="flex items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6">
            <p className="text-sm text-gray-400">AI recommendations unavailable for this session.</p>
          </div>
        )}
      </div>

      {/* Content Strengths */}
      {aiFeedback && aiFeedback.performanceSummary.contentStrengths.length > 0 && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Content Strengths</h2>
          <ul className="space-y-3">
            {aiFeedback.performanceSummary.contentStrengths.map((strength, i) => (
              <li key={i} className="flex gap-3 text-sm text-gray-700">
                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" />
                <span className="leading-relaxed">{strength}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Comparison with Best Practices */}
      {stats && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Comparison with Best Practices</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Metric</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Your Performance</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Best Practice</th>
                  <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {[
                  { key: 'wpm' as const, value: stats.avgWpm, display: `${stats.avgWpm} wpm` },
                  { key: 'eyeContact' as const, value: stats.avgEyeContact, display: `${stats.avgEyeContact}%` },
                  { key: 'fillers' as const, value: stats.totalFillers, display: `${stats.totalFillers}` },
                  { key: 'pauses' as const, value: stats.totalPauses, display: `${stats.totalPauses}` },
                ].map((row) => {
                  const bp = BEST_PRACTICES[row.key];
                  const passing = bp.check(row.value);
                  return (
                    <tr key={row.key} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">{bp.label}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-bold text-gray-900">{row.display}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">{bp.range}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-center">
                        {passing
                          ? <CheckCircle2 className="mx-auto h-5 w-5 text-green-500" />
                          : <AlertTriangle className="mx-auto h-5 w-5 text-yellow-500" />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Collapsible 30-Second Window Analysis */}
      {windows.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <button
            onClick={() => setShowWindows(!showWindows)}
            className="flex w-full items-center justify-between border-b border-gray-200 px-6 py-4 text-left hover:bg-gray-50 transition-colors"
          >
            <h2 className="text-lg font-semibold text-gray-900">30-Second Window Analysis</h2>
            {showWindows ? <ChevronUp className="h-5 w-5 text-gray-500" /> : <ChevronDown className="h-5 w-5 text-gray-500" />}
          </button>
          {showWindows && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Window</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Speaking Pace</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Volume</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Eye Contact</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Fillers</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Pauses</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {windows.map((w, index) => {
                    const prev = index > 0 ? windows[index - 1] : null;
                    return (
                      <tr key={w.windowNumber} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">#{w.windowNumber}</td>
                        <td className="px-6 py-4 text-sm">
                          <div className="flex items-center gap-2">
                            <span className={getScoreColor(w.speakingPace.average, 'wpm')}>{w.speakingPace.average} WPM</span>
                            {prev && getTrendIcon(w.speakingPace.average, prev.speakingPace.average)}
                          </div>
                          <span className="text-xs text-gray-500">&sigma;: {w.speakingPace.standardDeviation}</span>
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <div className="flex items-center gap-2">
                            <span className={getScoreColor(w.volumeLevel.average, 'volume')}>{w.volumeLevel.average}%</span>
                            {prev && getTrendIcon(w.volumeLevel.average, prev.volumeLevel.average)}
                          </div>
                          <span className="text-xs text-gray-500">&sigma;: {w.volumeLevel.standardDeviation}</span>
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <div className="flex items-center gap-2">
                            <span className={getScoreColor(w.eyeContactScore, 'eyeContact')}>{w.eyeContactScore}%</span>
                            {prev && getTrendIcon(w.eyeContactScore, prev.eyeContactScore)}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">{w.fillerWords}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">{w.pauses}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {windows.length === 0 && !aiFeedback && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-gray-500">No analytics data available</p>
        </div>
      )}
    </div>
  );
}
