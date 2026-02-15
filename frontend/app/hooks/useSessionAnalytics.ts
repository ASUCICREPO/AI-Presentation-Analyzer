'use client';

import { useRef, useCallback } from 'react';

export interface WindowAnalytics {
    windowNumber: number;
    timestamp: string;
    speakingPace: {
        average: number;
        standardDeviation: number;
    };
    volumeLevel: {
        average: number;
        standardDeviation: number;
    };
    eyeContactScore: number; // 0-100, higher is better
    fillerWords: number;
    pauses: number;
}

export interface SessionAnalytics {
    sessionId: string;
    startTime: string;
    endTime?: string;
    personaTitle: string;
    windows: WindowAnalytics[];
}

function calculateStdDev(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
}

export function useSessionAnalytics(sessionId: string, personaTitle: string) {
    const sessionDataRef = useRef<SessionAnalytics>({
        sessionId,
        startTime: new Date().toISOString(),
        personaTitle,
        windows: [],
    });

    // Track data for current 30-second window
    const currentWindowRef = useRef({
        windowNumber: 1,
        wpmValues: [] as number[],
        volumeValues: [] as number[],
        distractedSeconds: 0,
        fillerWords: 0,
        pauses: 0,
    });

    const windowStartTimeRef = useRef<number>(Date.now());

    // Update metrics during the window
    const updateMetrics = useCallback((metrics: {
        wpm?: number;
        volume?: number;
        isLookingAtScreen?: boolean;
        fillerWords?: number;
        pauses?: number;
    }) => {
        const current = currentWindowRef.current;

        if (metrics.wpm !== undefined && metrics.wpm > 0) {
            current.wpmValues.push(metrics.wpm);
        }

        if (metrics.volume !== undefined) {
            current.volumeValues.push(metrics.volume);
        }

        if (metrics.isLookingAtScreen === false) {
            // Track distracted time (called every second or so)
            current.distractedSeconds += 1;
        }

        if (metrics.fillerWords !== undefined) {
            current.fillerWords = metrics.fillerWords;
        }

        if (metrics.pauses !== undefined) {
            current.pauses = metrics.pauses;
        }
    }, []);

    // Finalize and save the current 30-second window
    const finalizeWindow = useCallback(() => {
        const current = currentWindowRef.current;
        const now = new Date();

        const wpmAvg = current.wpmValues.length > 0
            ? current.wpmValues.reduce((a, b) => a + b, 0) / current.wpmValues.length
            : 0;
        const wpmStdDev = calculateStdDev(current.wpmValues);

        const volumeAvg = current.volumeValues.length > 0
            ? current.volumeValues.reduce((a, b) => a + b, 0) / current.volumeValues.length
            : 0;
        const volumeStdDev = calculateStdDev(current.volumeValues);

        // Eye contact score: (30 - distractedSeconds) / 30 * 100
        const eyeContactScore = Math.max(0, Math.min(100,
            ((30 - current.distractedSeconds) / 30) * 100
        ));

        const windowData: WindowAnalytics = {
            windowNumber: current.windowNumber,
            timestamp: now.toISOString(),
            speakingPace: {
                average: Math.round(wpmAvg),
                standardDeviation: Math.round(wpmStdDev * 10) / 10,
            },
            volumeLevel: {
                average: Math.round(volumeAvg),
                standardDeviation: Math.round(volumeStdDev * 10) / 10,
            },
            eyeContactScore: Math.round(eyeContactScore),
            fillerWords: current.fillerWords,
            pauses: current.pauses,
        };

        sessionDataRef.current.windows.push(windowData);

        // Reset for next window
        currentWindowRef.current = {
            windowNumber: current.windowNumber + 1,
            wpmValues: [],
            volumeValues: [],
            distractedSeconds: 0,
            fillerWords: 0,
            pauses: 0,
        };
        windowStartTimeRef.current = Date.now();

        return windowData;
    }, []);

    // Get the complete session data
    const getSessionData = useCallback((): SessionAnalytics => {
        return {
            ...sessionDataRef.current,
            endTime: new Date().toISOString(),
        };
    }, []);

    // Download session data as JSON
    const downloadSessionData = useCallback(() => {
        const data = getSessionData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `session_analytics_${data.sessionId}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [getSessionData]);

    // Reset session data
    const resetSession = useCallback((newSessionId?: string) => {
        sessionDataRef.current = {
            sessionId: newSessionId || sessionId,
            startTime: new Date().toISOString(),
            personaTitle,
            windows: [],
        };
        currentWindowRef.current = {
            windowNumber: 1,
            wpmValues: [],
            volumeValues: [],
            distractedSeconds: 0,
            fillerWords: 0,
            pauses: 0,
        };
        windowStartTimeRef.current = Date.now();
    }, [sessionId, personaTitle]);

    return {
        updateMetrics,
        finalizeWindow,
        getSessionData,
        downloadSessionData,
        resetSession,
    };
}
