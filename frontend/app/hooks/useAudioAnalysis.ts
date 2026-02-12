'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { AUDIO_ANALYSIS_CONFIG } from '../config/config';
import { createTranscriptionProvider } from '../transcription';
import type { TranscriptionProvider } from '../transcription';
import { useAuth } from '../context/AuthContext';

// ─── Types ───────────────────────────────────────────────────────────
export interface AudioMetrics {
  wpm: number;
  volume: number;        // 0-100
  fillerWords: number;
  pauses: number;
}

export interface TranscriptEntry {
  text: string;
  isFinal: boolean;
  timestamp: string;
}

interface AudioAnalysisReturn {
  metrics: AudioMetrics;
  transcripts: TranscriptEntry[];
  partialTranscript: string;
  isTranscribing: boolean;
  error: string | null;
  startAnalysis: (stream: MediaStream) => Promise<void>;
  pauseAnalysis: () => void;
  resumeAnalysis: () => void;
  stopAnalysis: () => void;
}

// ─── Destructured config ─────────────────────────────────────────────
const { FILLER_WORDS, SILENCE, VOLUME, WINDOWS, METRICS, TRANSCRIPT, TRANSCRIPTION } = AUDIO_ANALYSIS_CONFIG;
const { THRESHOLD: SILENCE_THRESHOLD, PAUSE_DURATION_MS } = SILENCE;
const { EMA_ALPHA, MAX_RMS: VOLUME_MAX_RMS } = VOLUME;
const { MAX_ENTRIES: MAX_TRANSCRIPT_ENTRIES } = TRANSCRIPT;

// Pick the worklet sample rate from whichever provider is active
const WORKLET_SAMPLE_RATE =
  TRANSCRIPTION.PROVIDER === 'aws-transcribe'
    ? TRANSCRIPTION.AWS_TRANSCRIBE.SAMPLE_RATE
    : TRANSCRIPTION.WEB_SPEECH.SAMPLE_RATE;

// ─── Helpers ─────────────────────────────────────────────────────────

/** Format seconds to MM:SS */
function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ─── Hook ────────────────────────────────────────────────────────────
export function useAudioAnalysis(): AudioAnalysisReturn {
  const { getIdToken } = useAuth();

  const [metrics, setMetrics] = useState<AudioMetrics>({ wpm: 0, volume: 0, fillerWords: 0, pauses: 0 });
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for mutable state that doesn't need re-render
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const providerRef = useRef<TranscriptionProvider | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedDurationRef = useRef<number>(0);
  const pausedAtRef = useRef<number | null>(null);
  const metricsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);
  const analysisPausedRef = useRef(false);

  // Volume: Exponential Moving Average
  const emaVolumeRef = useRef(0);

  // Sliding-window timestamped entries for rolling counters
  const wordEntriesRef = useRef<{ time: number; count: number }[]>([]);
  const fillerEntriesRef = useRef<number[]>([]);
  const pauseEntriesRef = useRef<number[]>([]);

  // Silence/pause tracking
  const inSilenceRef = useRef(false);
  const silenceStartRef = useRef<number>(0);
  const pauseAlreadyCountedRef = useRef(false);

  // ─── Calculate and emit metrics ───
  const emitMetrics = useCallback(() => {
    const now = Date.now();

    // 1. Speaking pace — sliding window WPM
    const paceStart = now - WINDOWS.PACE_SECONDS * 1000;
    const wordEntries = wordEntriesRef.current;
    while (wordEntries.length > 0 && wordEntries[0].time < paceStart) wordEntries.shift();
    const windowWords = wordEntries.reduce((sum, e) => sum + e.count, 0);
    const sessionAge = now - startTimeRef.current - pausedDurationRef.current
      - (pausedAtRef.current ? now - pausedAtRef.current : 0);
    const windowMs = Math.min(WINDOWS.PACE_SECONDS * 1000, Math.max(sessionAge, 1));
    // Require at least 5 seconds of data (0.083 min) before showing WPM to
    // avoid wild spikes when Transcribe delivers a batch of words early on.
    const rawWpm = windowMs / 60000 > 0.083 ? Math.round(windowWords / (windowMs / 60000)) : 0;
    // Hard cap: human speech rarely exceeds 200 wpm in presentations
    const wpm = Math.min(rawWpm, 250);

    // 2. Volume from EMA
    const volume = Math.round(Math.min(100, (emaVolumeRef.current / VOLUME_MAX_RMS) * 100));

    // 3. Filler words — rolling window
    const fillerStart = now - WINDOWS.FILLER_SECONDS * 1000;
    const fillerEntries = fillerEntriesRef.current;
    while (fillerEntries.length > 0 && fillerEntries[0] < fillerStart) fillerEntries.shift();

    // 4. Pauses — rolling window
    const pauseStart = now - WINDOWS.PAUSE_SECONDS * 1000;
    const pauseEntries = pauseEntriesRef.current;
    while (pauseEntries.length > 0 && pauseEntries[0] < pauseStart) pauseEntries.shift();

    // 5. Real-time pause check
    if (inSilenceRef.current && !pauseAlreadyCountedRef.current && silenceStartRef.current > 0) {
      const silenceDur = now - silenceStartRef.current;
      if (silenceDur > PAUSE_DURATION_MS) {
        pauseEntries.push(now);
        pauseAlreadyCountedRef.current = true;
      }
    }

    setMetrics({ wpm, volume, fillerWords: fillerEntries.length, pauses: pauseEntries.length });
  }, []);

  // ─── Process final transcript text ───
  const processFinalTranscript = useCallback((text: string) => {
    if (!text.trim()) return;
    const words = text.toLowerCase().trim().split(/\s+/);

    // Spread word timestamps across an estimated speaking duration instead of
    // lumping every word at Date.now().  Assume ~150 wpm natural speech rate
    // (~400ms per word) so a 10-word phrase is spread across ~4 seconds.
    const now = Date.now();
    const estimatedDurationMs = words.length * 400; // ~150 wpm baseline
    const spreadStart = Math.max(startTimeRef.current, now - estimatedDurationMs);
    const step = words.length > 1 ? (now - spreadStart) / (words.length - 1) : 0;
    for (let i = 0; i < words.length; i++) {
      wordEntriesRef.current.push({ time: Math.round(spreadStart + step * i), count: 1 });
    }

    const ts = Date.now();
    words.forEach((w) => {
      const clean = w.replace(/[.,!?;:'"()\-]/g, '');
      if (FILLER_WORDS.includes(clean)) fillerEntriesRef.current.push(ts);
    });

    const totalElapsed = Date.now() - startTimeRef.current;
    const effectiveMs = totalElapsed - pausedDurationRef.current;
    const elapsed = Math.max(0, Math.floor(effectiveMs / 1000));
    setTranscripts((prev) => [
      ...prev,
      { text: text.trim(), isFinal: true, timestamp: formatTime(elapsed) },
    ].slice(-MAX_TRANSCRIPT_ENTRIES));
    setPartialTranscript('');
    emitMetrics();
  }, [emitMetrics]);

  // ─── Pause ───
  const pauseAnalysis = useCallback(() => {
    if (!activeRef.current || analysisPausedRef.current) return;
    analysisPausedRef.current = true;
    pausedAtRef.current = Date.now();

    // Suspend the audio worklet context
    if (audioContextRef.current && audioContextRef.current.state === 'running') {
      audioContextRef.current.suspend();
    }

    // Pause the transcription provider
    providerRef.current?.pause();

    if (metricsIntervalRef.current) {
      clearInterval(metricsIntervalRef.current);
      metricsIntervalRef.current = null;
    }

    setPartialTranscript('');
    setIsTranscribing(false);
  }, []);

  // ─── Resume ───
  const resumeAnalysis = useCallback(() => {
    if (!activeRef.current || !analysisPausedRef.current) return;
    analysisPausedRef.current = false;

    if (pausedAtRef.current) {
      pausedDurationRef.current += Date.now() - pausedAtRef.current;
      pausedAtRef.current = null;
    }

    inSilenceRef.current = false;
    silenceStartRef.current = 0;
    pauseAlreadyCountedRef.current = false;

    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }

    // Resume the transcription provider
    providerRef.current?.resume();

    metricsIntervalRef.current = setInterval(emitMetrics, METRICS.EMIT_INTERVAL_MS);
    setIsTranscribing(true);
  }, [emitMetrics]);

  // ─── Start ───
  const startAnalysis = useCallback(async (stream: MediaStream) => {
    setError(null);
    activeRef.current = true;
    analysisPausedRef.current = false;

    // Reset counters
    pausedDurationRef.current = 0;
    pausedAtRef.current = null;
    emaVolumeRef.current = 0;
    wordEntriesRef.current = [];
    fillerEntriesRef.current = [];
    pauseEntriesRef.current = [];
    inSilenceRef.current = false;
    silenceStartRef.current = 0;
    pauseAlreadyCountedRef.current = false;
    startTimeRef.current = Date.now();
    setMetrics({ wpm: 0, volume: 0, fillerWords: 0, pauses: 0 });
    setTranscripts([]);
    setPartialTranscript('');

    try {
      // ──────────────────────────────────────────────────────────────
      // 1. AudioContext + Worklet for volume / pause metering
      //    (Both providers need this; the AWS provider also creates its
      //     own AudioContext internally for PCM capture.)
      // ──────────────────────────────────────────────────────────────
      const audioCtx = new AudioContext({ sampleRate: WORKLET_SAMPLE_RATE });
      audioContextRef.current = audioCtx;

      // Ensure the AudioContext is running before creating worklet nodes.
      // Browsers may start contexts in a "suspended" state; attempting to
      // construct an AudioWorkletNode while suspended throws
      // "No execution context available".
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const source = audioCtx.createMediaStreamSource(stream);
      await audioCtx.audioWorklet.addModule('/audio-capture-processor.js');
      const workletNode = new AudioWorkletNode(audioCtx, 'audio-capture-processor');
      workletNodeRef.current = workletNode;
      source.connect(workletNode);
      workletNode.connect(audioCtx.destination);

      workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (!activeRef.current || analysisPausedRef.current) return;
        const float32 = e.data;

        // Volume EMA
        let sum = 0;
        for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
        const rms = Math.sqrt(sum / float32.length);
        emaVolumeRef.current = EMA_ALPHA * rms + (1 - EMA_ALPHA) * emaVolumeRef.current;

        // Pause detection
        if (rms < SILENCE_THRESHOLD) {
          if (!inSilenceRef.current) {
            inSilenceRef.current = true;
            silenceStartRef.current = Date.now();
            pauseAlreadyCountedRef.current = false;
          } else if (!pauseAlreadyCountedRef.current) {
            const dur = Date.now() - silenceStartRef.current;
            if (dur > PAUSE_DURATION_MS) {
              pauseEntriesRef.current.push(Date.now());
              pauseAlreadyCountedRef.current = true;
              emitMetrics();
            }
          }
        } else {
          inSilenceRef.current = false;
          pauseAlreadyCountedRef.current = false;
        }
      };

      metricsIntervalRef.current = setInterval(emitMetrics, METRICS.EMIT_INTERVAL_MS);

      // ──────────────────────────────────────────────────────────────
      // 2. Create and start the transcription provider
      // ──────────────────────────────────────────────────────────────
      const provider = createTranscriptionProvider(getIdToken);
      providerRef.current = provider;

      await provider.start(stream, {
        onFinalTranscript: processFinalTranscript,
        onPartialTranscript: setPartialTranscript,
        onError: (msg) => setError(msg),
      });

      setIsTranscribing(true);
    } catch (err) {
      console.error('Audio analysis error:', err);
      const msg = err instanceof Error ? err.message : 'Audio analysis failed';
      setError(msg);
    }
  }, [getIdToken, emitMetrics, processFinalTranscript]);

  // ─── Stop ───
  const stopAnalysis = useCallback(() => {
    activeRef.current = false;
    analysisPausedRef.current = false;
    setIsTranscribing(false);
    setPartialTranscript('');

    // Final silence check
    if (inSilenceRef.current && silenceStartRef.current > 0) {
      const dur = Date.now() - silenceStartRef.current;
      if (dur > PAUSE_DURATION_MS && !pauseAlreadyCountedRef.current) {
        pauseEntriesRef.current.push(Date.now());
      }
      inSilenceRef.current = false;
    }

    // Stop transcription provider
    providerRef.current?.stop();
    providerRef.current = null;

    // Stop worklet
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage('stop');
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Stop metrics interval
    if (metricsIntervalRef.current) {
      clearInterval(metricsIntervalRef.current);
      metricsIntervalRef.current = null;
    }

    emitMetrics();
  }, [emitMetrics]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (activeRef.current) stopAnalysis();
    };
  }, [stopAnalysis]);

  return {
    metrics,
    transcripts,
    partialTranscript,
    isTranscribing,
    error,
    startAnalysis,
    pauseAnalysis,
    resumeAnalysis,
    stopAnalysis,
  };
}
