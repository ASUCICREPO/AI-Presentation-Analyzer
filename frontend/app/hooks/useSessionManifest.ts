'use client';

import { useRef, useCallback } from 'react';
import { uploadJsonToS3 } from '../services/api';

// ─── Manifest shape ──────────────────────────────────────────────────
export type ManifestStatus = 'in_progress' | 'completed' | 'aborted';

export interface SessionManifest {
  sessionId: string;
  persona: string;
  /** Array of all selected persona IDs (multi-persona support) */
  personas: string[];
  startTime: string;
  endTime?: string;
  status: ManifestStatus;
  /** Number of video multipart parts successfully uploaded */
  videoParts: number;
  /** ISO timestamp of the last metrics / manifest flush */
  lastUpdated: string;
  /** Total session duration in seconds (set on completion) */
  duration?: number;
  /** Whether a presentation PDF was uploaded before the session */
  hasPresentationPdf?: boolean;
  /** Whether persona customization text was provided */
  hasPersonaCustomization?: boolean;
}

/**
 * Hook that manages a lightweight session manifest stored in S3.
 *
 * The manifest is created at session start and updated:
 *   - after each video chunk upload (videoParts count)
 *   - on session completion (status → "completed", duration, endTime)
 *
 * Because it's just a JSON overwrite each time, it also acts as a
 * heartbeat — downstream systems can check lastUpdated to detect
 * stuck / abandoned sessions.
 *
 * Usage:
 *   const manifest = useSessionManifest(sessionId, personaTitle);
 *   await manifest.create();                     // on session start
 *   await manifest.update({ videoParts: 3 });    // after each video chunk
 *   await manifest.complete(timer);              // on session end
 */
export function useSessionManifest(sessionId: string, personaId: string, personaIds?: string[]) {
  const manifestRef = useRef<SessionManifest | null>(null);
  const flushingRef = useRef(false);

  // ─── Create — call once when the session starts ────────────────────
  const create = useCallback(
    async (opts?: { hasPresentationPdf?: boolean; hasPersonaCustomization?: boolean }) => {
      const now = new Date().toISOString();
      const m: SessionManifest = {
        sessionId,
        persona: personaId,
        personas: personaIds ?? [personaId],
        startTime: now,
        status: 'in_progress',
        videoParts: 0,
        lastUpdated: now,
        hasPresentationPdf: opts?.hasPresentationPdf ?? false,
        hasPersonaCustomization: opts?.hasPersonaCustomization ?? false,
      };
      manifestRef.current = m;

      try {
        await uploadJsonToS3('manifest', sessionId, m);
        console.log('[useSessionManifest] Manifest created');
      } catch (err) {
        console.error('[useSessionManifest] Failed to create manifest:', err);
      }
    },
    [sessionId, personaId, personaIds],
  );

  // ─── Update — merge partial fields and flush to S3 ─────────────────
  const update = useCallback(
    async (patch: Partial<Pick<SessionManifest, 'videoParts' | 'hasPresentationPdf' | 'hasPersonaCustomization'>>) => {
      if (!manifestRef.current) return;
      // Prevent concurrent flushes from stacking up
      if (flushingRef.current) return;

      manifestRef.current = {
        ...manifestRef.current,
        ...patch,
        lastUpdated: new Date().toISOString(),
      };

      flushingRef.current = true;
      try {
        await uploadJsonToS3('manifest', sessionId, manifestRef.current);
      } catch (err) {
        console.error('[useSessionManifest] Failed to update manifest:', err);
      } finally {
        flushingRef.current = false;
      }
    },
    [sessionId],
  );

  // ─── Complete — finalize the session ────────────────────────────────
  const complete = useCallback(
    async (durationSec: number) => {
      if (!manifestRef.current) return;

      const now = new Date().toISOString();
      manifestRef.current = {
        ...manifestRef.current,
        status: 'completed',
        endTime: now,
        duration: durationSec,
        lastUpdated: now,
      };

      try {
        await uploadJsonToS3('manifest', sessionId, manifestRef.current);
        console.log('[useSessionManifest] Manifest completed');
      } catch (err) {
        console.error('[useSessionManifest] Failed to complete manifest:', err);
      }
    },
    [sessionId],
  );

  // ─── Abort — mark session as aborted ───────────────────────────────
  const abort = useCallback(
    async (durationSec?: number) => {
      if (!manifestRef.current) return;

      const now = new Date().toISOString();
      manifestRef.current = {
        ...manifestRef.current,
        status: 'aborted',
        endTime: now,
        duration: durationSec,
        lastUpdated: now,
      };

      try {
        await uploadJsonToS3('manifest', sessionId, manifestRef.current);
        console.log('[useSessionManifest] Manifest aborted');
      } catch (err) {
        console.error('[useSessionManifest] Failed to abort manifest:', err);
      }
    },
    [sessionId],
  );

  return { create, update, complete, abort };
}
