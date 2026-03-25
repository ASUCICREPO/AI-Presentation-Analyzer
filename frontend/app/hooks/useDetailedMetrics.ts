'use client';

import { useRef, useCallback } from 'react';

/**
 * A single per-second metrics snapshot.
 * Collected every ~1 s while the session is active.
 */
export interface MetricSnapshot {
  /** Seconds since recording started (0-based) */
  t: number;
  /** Words per minute at this instant */
  wpm: number;
  /** Volume level (0-1) */
  vol: number;
  /** Whether the user was looking at the screen */
  gaze: boolean;
  /** Filler word count in the current sliding window */
  fillers: number;
  /** Pause count in the current sliding window */
  pauses: number;
  /** Gaze direction string (Center, Left, Right, Up, Down) */
  direction: string;
}

export interface DetailedMetricsData {
  sessionId: string;
  startTime: string;
  endTime?: string;
  /** Per-second snapshots — the core of the detailed metrics */
  snapshots: MetricSnapshot[];
}

/**
 * Hook that collects per-second metric snapshots during a practice session.
 *
 * Usage:
 *   const dm = useDetailedMetrics(sessionId);
 *   dm.record({ wpm, vol, gaze, fillers, pauses, direction });   // call every ~1 s
 *   const data = dm.getData();  // call at session end
 */
export function useDetailedMetrics(sessionId: string) {
  const snapshotsRef = useRef<MetricSnapshot[]>([]);
  const startTimeRef = useRef<string | null>(null);
  const tickRef = useRef(0);

  /** Reset all collected data (call when starting a new recording). */
  const reset = useCallback(() => {
    snapshotsRef.current = [];
    startTimeRef.current = new Date().toISOString();
    tickRef.current = 0;
  }, []);

  /** Record one per-second snapshot. */
  const record = useCallback(
    (metrics: Omit<MetricSnapshot, 't'>) => {
      if (!startTimeRef.current) {
        startTimeRef.current = new Date().toISOString();
      }
      snapshotsRef.current.push({ t: tickRef.current++, ...metrics });
    },
    [],
  );

  /** Return the complete data blob for upload. */
  const getData = useCallback((): DetailedMetricsData => {
    return {
      sessionId,
      startTime: startTimeRef.current ?? new Date().toISOString(),
      endTime: new Date().toISOString(),
      snapshots: snapshotsRef.current,
    };
  }, [sessionId]);

  return { reset, record, getData };
}
