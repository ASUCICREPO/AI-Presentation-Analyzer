'use client';

import React from 'react';
import { SessionAnalytics, WindowAnalytics } from '../hooks/useSessionAnalytics';
import { Download, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface ReviewAnalyticsProps {
    sessionData: SessionAnalytics;
    onDownload: () => void;
    onBackToStart: () => void;
}

export default function ReviewAnalytics({ sessionData, onDownload, onBackToStart }: ReviewAnalyticsProps) {
    const { windows } = sessionData;

    // Calculate overall statistics
    const calculateOverallStats = () => {
        if (windows.length === 0) return null;

        const avgWpm = windows.reduce((sum, w) => sum + w.speakingPace.average, 0) / windows.length;
        const avgVolume = windows.reduce((sum, w) => sum + w.volumeLevel.average, 0) / windows.length;
        const avgEyeContact = windows.reduce((sum, w) => sum + w.eyeContactScore, 0) / windows.length;
        const totalFillers = windows.reduce((sum, w) => sum + w.fillerWords, 0);
        const totalPauses = windows.reduce((sum, w) => sum + w.pauses, 0);

        return {
            avgWpm: Math.round(avgWpm),
            avgVolume: Math.round(avgVolume),
            avgEyeContact: Math.round(avgEyeContact),
            totalFillers,
            totalPauses,
            totalWindows: windows.length,
        };
    };

    const stats = calculateOverallStats();

    const getTrendIcon = (current: number, previous: number) => {
        if (current > previous) return <TrendingUp className="w-4 h-4 text-green-600" />;
        if (current < previous) return <TrendingDown className="w-4 h-4 text-red-600" />;
        return <Minus className="w-4 h-4 text-gray-400" />;
    };

    const getScoreColor = (score: number, type: 'wpm' | 'volume' | 'eyeContact') => {
        if (type === 'wpm') {
            if (score >= 120 && score <= 150) return 'text-green-600';
            if (score >= 100 && score <= 170) return 'text-yellow-600';
            return 'text-red-600';
        }
        if (type === 'volume') {
            if (score >= 40 && score <= 80) return 'text-green-600';
            if (score >= 20 && score <= 90) return 'text-yellow-600';
            return 'text-red-600';
        }
        if (type === 'eyeContact') {
            if (score >= 80) return 'text-green-600';
            if (score >= 60) return 'text-yellow-600';
            return 'text-red-600';
        }
    };

    return (
        <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Session Analytics</h1>
                    <p className="mt-1 text-sm text-gray-600">
                        {sessionData.personaTitle} • {windows.length} windows recorded
                    </p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={onDownload}
                        className="flex items-center gap-2 rounded-lg bg-maroon px-4 py-2 text-white hover:bg-maroon/90 transition-colors"
                    >
                        <Download className="w-4 h-4" />
                        Download JSON
                    </button>
                    <button
                        onClick={onBackToStart}
                        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                        Back to Start
                    </button>
                </div>
            </div>

            {/* Overall Statistics */}
            {stats && (
                <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                        <p className="text-sm text-gray-600">Avg Speaking Pace</p>
                        <p className={`text-2xl font-bold ${getScoreColor(stats.avgWpm, 'wpm')}`}>
                            {stats.avgWpm} <span className="text-sm font-normal">WPM</span>
                        </p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                        <p className="text-sm text-gray-600">Avg Volume</p>
                        <p className={`text-2xl font-bold ${getScoreColor(stats.avgVolume, 'volume')}`}>
                            {stats.avgVolume}%
                        </p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                        <p className="text-sm text-gray-600">Avg Eye Contact</p>
                        <p className={`text-2xl font-bold ${getScoreColor(stats.avgEyeContact, 'eyeContact')}`}>
                            {stats.avgEyeContact}%
                        </p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                        <p className="text-sm text-gray-600">Total Filler Words</p>
                        <p className="text-2xl font-bold text-gray-900">{stats.totalFillers}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                        <p className="text-sm text-gray-600">Total Pauses</p>
                        <p className="text-2xl font-bold text-gray-900">{stats.totalPauses}</p>
                    </div>
                </div>
            )}

            {/* 30-Second Windows */}
            <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-200 px-6 py-4">
                    <h2 className="text-xl font-semibold text-gray-900">30-Second Window Analysis</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                    Window
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                    Speaking Pace
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                    Volume
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                    Eye Contact
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                    Fillers
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                    Pauses
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                            {windows.map((window, index) => {
                                const prevWindow = index > 0 ? windows[index - 1] : null;
                                return (
                                    <tr key={window.windowNumber} className="hover:bg-gray-50">
                                        <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                                            #{window.windowNumber}
                                        </td>
                                        <td className="px-6 py-4 text-sm">
                                            <div className="flex items-center gap-2">
                                                <span className={getScoreColor(window.speakingPace.average, 'wpm')}>
                                                    {window.speakingPace.average} WPM
                                                </span>
                                                {prevWindow && getTrendIcon(window.speakingPace.average, prevWindow.speakingPace.average)}
                                            </div>
                                            <span className="text-xs text-gray-500">σ: {window.speakingPace.standardDeviation}</span>
                                        </td>
                                        <td className="px-6 py-4 text-sm">
                                            <div className="flex items-center gap-2">
                                                <span className={getScoreColor(window.volumeLevel.average, 'volume')}>
                                                    {window.volumeLevel.average}%
                                                </span>
                                                {prevWindow && getTrendIcon(window.volumeLevel.average, prevWindow.volumeLevel.average)}
                                            </div>
                                            <span className="text-xs text-gray-500">σ: {window.volumeLevel.standardDeviation}</span>
                                        </td>
                                        <td className="px-6 py-4 text-sm">
                                            <div className="flex items-center gap-2">
                                                <span className={getScoreColor(window.eyeContactScore, 'eyeContact')}>
                                                    {window.eyeContactScore}%
                                                </span>
                                                {prevWindow && getTrendIcon(window.eyeContactScore, prevWindow.eyeContactScore)}
                                            </div>
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                                            {window.fillerWords}
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                                            {window.pauses}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {windows.length === 0 && (
                <div className="flex min-h-[40vh] items-center justify-center">
                    <p className="text-gray-500">No analytics data available</p>
                </div>
            )}
        </div>
    );
}
