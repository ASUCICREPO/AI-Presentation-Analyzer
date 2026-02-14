'use client';

import { useRef, useCallback, useState } from 'react';
import { VIDEO_RECORDING_CONFIG } from '../config/config';
import {
  initiateMultipartUpload,
  getMultipartPartUrl,
  uploadMultipartPart,
  completeMultipartUpload,
  abortMultipartUpload,
} from '../services/api';

export interface VideoRecordingState {
  isRecording: boolean;
  /** Number of chunks (parts) successfully uploaded so far */
  partsUploaded: number;
  error: string | null;
}

export interface VideoRecordingOptions {
  /** Called after each part is successfully uploaded to S3. */
  onPartUploaded?: (partsUploaded: number) => void;
}

/**
 * Hook that manages video recording via MediaRecorder and streams chunks
 * to S3 using multipart upload (one part per ~30 s interval).
 *
 * Usage:
 *   const video = useVideoRecording(sessionId, {
 *     onPartUploaded: (n) => manifest.update({ videoParts: n }),
 *   });
 *   await video.start(mediaStream);
 *   video.pause();
 *   video.resume();
 *   await video.stop();   // flushes remaining data & completes the upload
 */
export function useVideoRecording(sessionId: string, options?: VideoRecordingOptions) {
  const [state, setState] = useState<VideoRecordingState>({
    isRecording: false,
    partsUploaded: 0,
    error: null,
  });

  // Refs for mutable state that doesn't need to trigger re-renders
  const recorderRef = useRef<MediaRecorder | null>(null);
  const uploadIdRef = useRef<string | null>(null);
  const partNumberRef = useRef(1);
  const partsRef = useRef<{ PartNumber: number; ETag: string }[]>([]);
  const bufferRef = useRef<Blob[]>([]);
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);
  const onPartUploadedRef = useRef(options?.onPartUploaded);
  onPartUploadedRef.current = options?.onPartUploaded;

  // ─── Flush buffered chunks as a single multipart part ──────────────
  const flushBuffer = useCallback(async () => {
    if (!uploadIdRef.current || bufferRef.current.length === 0) return;

    const blob = new Blob(bufferRef.current, { type: 'video/webm' });
    bufferRef.current = [];

    const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);

    // S3 multipart requires minimum 5 MB per part (except the last).
    // With the configured bitrate, 30s should produce ~5.6 MB.
    // If somehow still under the limit, hold the data for next flush.
    if (blob.size < VIDEO_RECORDING_CONFIG.MIN_PART_SIZE_BYTES && activeRef.current) {
      console.log(`[useVideoRecording] Buffer ${sizeMB} MB < 5 MB minimum, holding for next flush`);
      bufferRef.current.push(blob);
      return;
    }

    const partNum = partNumberRef.current++;
    console.log(`[useVideoRecording] Uploading part ${partNum} (${sizeMB} MB)`);
    try {
      const { url } = await getMultipartPartUrl(sessionId, uploadIdRef.current, partNum);
      const etag = await uploadMultipartPart(url, blob);
      partsRef.current.push({ PartNumber: partNum, ETag: etag });
      const count = partsRef.current.length;
      setState((prev) => ({ ...prev, partsUploaded: count }));
      onPartUploadedRef.current?.(count);
    } catch (err) {
      console.error(`[useVideoRecording] Failed to upload part ${partNum}:`, err);
      setState((prev) => ({
        ...prev,
        error: `Failed to upload video chunk ${partNum}`,
      }));
    }
  }, [sessionId]);

  // ─── Start ─────────────────────────────────────────────────────────
  const start = useCallback(
    async (stream: MediaStream) => {
      try {
        // 1. Initiate multipart upload on the backend
        const { uploadId } = await initiateMultipartUpload(sessionId);
        uploadIdRef.current = uploadId;
        partNumberRef.current = 1;
        partsRef.current = [];
        bufferRef.current = [];
        activeRef.current = true;

        // 2. Choose a supported MIME type
        const mimeType = MediaRecorder.isTypeSupported(VIDEO_RECORDING_CONFIG.MIME_TYPE)
          ? VIDEO_RECORDING_CONFIG.MIME_TYPE
          : VIDEO_RECORDING_CONFIG.FALLBACK_MIME_TYPE;

        // 3. Create MediaRecorder
        const recorder = new MediaRecorder(stream, { mimeType });
        recorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            bufferRef.current.push(e.data);
          }
        };

        recorder.onerror = (e) => {
          console.error('[useVideoRecording] MediaRecorder error:', e);
          setState((prev) => ({ ...prev, error: 'MediaRecorder error' }));
        };

        recorder.start(VIDEO_RECORDING_CONFIG.TIMESLICE_MS);

        // 4. Periodically flush the buffer to S3
        flushIntervalRef.current = setInterval(
          flushBuffer,
          VIDEO_RECORDING_CONFIG.CHUNK_INTERVAL_MS,
        );

        setState({ isRecording: true, partsUploaded: 0, error: null });
      } catch (err) {
        console.error('[useVideoRecording] Failed to start:', err);
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : 'Failed to start recording',
        }));
      }
    },
    [sessionId, flushBuffer],
  );

  // ─── Pause / Resume ────────────────────────────────────────────────
  const pause = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.pause();
    }
  }, []);

  const resume = useCallback(() => {
    if (recorderRef.current?.state === 'paused') {
      recorderRef.current.resume();
    }
  }, []);

  // ─── Stop ──────────────────────────────────────────────────────────
  const stop = useCallback(async () => {
    activeRef.current = false;

    // Stop the periodic flush
    if (flushIntervalRef.current) {
      clearInterval(flushIntervalRef.current);
      flushIntervalRef.current = null;
    }

    // Stop MediaRecorder — collect any remaining data
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorderRef.current!.onstop = () => resolve();
        recorderRef.current!.stop();
      });
    }
    recorderRef.current = null;

    // Final flush (upload whatever is left in the buffer, even < 5 MB)
    if (uploadIdRef.current && bufferRef.current.length > 0) {
      const blob = new Blob(bufferRef.current, { type: 'video/webm' });
      bufferRef.current = [];

      if (blob.size > 0) {
        const partNum = partNumberRef.current++;
        try {
          const { url } = await getMultipartPartUrl(sessionId, uploadIdRef.current, partNum);
          const etag = await uploadMultipartPart(url, blob);
          partsRef.current.push({ PartNumber: partNum, ETag: etag });
        } catch (err) {
          console.error('[useVideoRecording] Failed to upload final part:', err);
        }
      }
    }

    // Complete the multipart upload
    if (uploadIdRef.current && partsRef.current.length > 0) {
      try {
        await completeMultipartUpload(sessionId, uploadIdRef.current, partsRef.current);
        console.log(`[useVideoRecording] Multipart upload completed (${partsRef.current.length} parts)`);
      } catch (err) {
        console.error('[useVideoRecording] Failed to complete multipart upload:', err);
        setState((prev) => ({ ...prev, error: 'Failed to finalize video upload' }));
      }
    }

    uploadIdRef.current = null;
    setState((prev) => ({ ...prev, isRecording: false }));
  }, [sessionId]);

  // ─── Abort (e.g. user cancels session) ─────────────────────────────
  const abort = useCallback(async () => {
    activeRef.current = false;

    if (flushIntervalRef.current) {
      clearInterval(flushIntervalRef.current);
      flushIntervalRef.current = null;
    }

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    bufferRef.current = [];

    if (uploadIdRef.current) {
      try {
        await abortMultipartUpload(sessionId, uploadIdRef.current);
      } catch (err) {
        console.error('[useVideoRecording] Failed to abort multipart upload:', err);
      }
    }
    uploadIdRef.current = null;
    setState({ isRecording: false, partsUploaded: 0, error: null });
  }, [sessionId]);

  return { ...state, start, pause, resume, stop, abort };
}
