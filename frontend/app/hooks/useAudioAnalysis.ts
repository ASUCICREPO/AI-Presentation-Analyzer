'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { TranscribeStreamingClient, StartStreamTranscriptionCommand } from '@aws-sdk/client-transcribe-streaming';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { cognitoConfig, AUDIO_ANALYSIS_CONFIG } from '../config/config';
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
const { FILLER_WORDS, TRANSCRIBE, CHUNKING, SILENCE, VOLUME, WINDOWS, METRICS, TRANSCRIPT } = AUDIO_ANALYSIS_CONFIG;
const { SAMPLE_RATE } = TRANSCRIBE;
const { TARGET_CHUNK_BYTES, MAX_AUDIO_QUEUE_CHUNKS } = CHUNKING;
const { THRESHOLD: SILENCE_THRESHOLD, PAUSE_DURATION_MS } = SILENCE;
const { EMA_ALPHA, MAX_RMS: VOLUME_MAX_RMS } = VOLUME;
const { MAX_ENTRIES: MAX_TRANSCRIPT_ENTRIES, PARTIAL_EMIT_INTERVAL_MS } = TRANSCRIPT;

// ─── Helpers ─────────────────────────────────────────────────────────

/** Convert Float32 audio samples to Int16 PCM bytes for Transcribe */
function float32ToInt16(float32: Float32Array): Uint8Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Uint8Array(int16.buffer);
}

/** Create a push-based async iterable for Transcribe AudioStream */
function createAudioStream(maxQueueChunks = MAX_AUDIO_QUEUE_CHUNKS) {
  const queue: Uint8Array[] = [];
  let resolve: ((val: IteratorResult<{ AudioEvent: { AudioChunk: Uint8Array } }>) => void) | null = null;
  let done = false;

  return {
    push(chunk: Uint8Array) {
      if (done) return;
      const event = { AudioEvent: { AudioChunk: chunk } };
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: event, done: false });
      } else {
        // Keep queue bounded so latency cannot grow indefinitely over long sessions.
        if (queue.length >= maxQueueChunks) queue.shift();
        queue.push(chunk);
      }
    },
    end() {
      done = true;
      if (resolve) resolve({ value: undefined as unknown as { AudioEvent: { AudioChunk: Uint8Array } }, done: true });
    },
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<{ AudioEvent: { AudioChunk: Uint8Array } }>> {
          if (queue.length > 0) {
            const chunk = queue.shift()!;
            return Promise.resolve({ value: { AudioEvent: { AudioChunk: chunk } }, done: false });
          }
          if (done) return Promise.resolve({ value: undefined as unknown as { AudioEvent: { AudioChunk: Uint8Array } }, done: true });
          return new Promise((r) => { resolve = r; });
        },
      };
    },
  };
}

/** Concatenate Uint8Arrays */
function concatUint8Arrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

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
  const audioStreamRef = useRef<ReturnType<typeof createAudioStream> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedDurationRef = useRef<number>(0);  // total ms spent paused
  const pausedAtRef = useRef<number | null>(null); // timestamp when we paused
  const metricsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);
  const analysisPausedRef = useRef(false);
  const pcmCarryRef = useRef<Uint8Array>(new Uint8Array(0));
  const lastPartialEmitRef = useRef(0);

  // Volume: Exponential Moving Average for a responsive, smooth meter
  const emaVolumeRef = useRef(0);

  // Sliding-window timestamped entries for all rolling counters
  const wordEntriesRef = useRef<{ time: number; count: number }[]>([]);
  const fillerEntriesRef = useRef<number[]>([]);   // timestamps of each filler detected
  const pauseEntriesRef = useRef<number[]>([]);     // timestamps of each pause detected

  // Silence/pause tracking refs
  const inSilenceRef = useRef(false);
  const silenceStartRef = useRef<number>(0);
  const pauseAlreadyCountedRef = useRef(false); // prevents double-counting same pause

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
    const wpm = windowMs / 60000 > 0.05 ? Math.round(windowWords / (windowMs / 60000)) : 0;

    // 2. Volume from EMA (already updated per-frame in worklet handler)
    const volume = Math.round(Math.min(100, (emaVolumeRef.current / VOLUME_MAX_RMS) * 100));

    // 3. Filler words — only count those within the rolling window
    const fillerStart = now - WINDOWS.FILLER_SECONDS * 1000;
    const fillerEntries = fillerEntriesRef.current;
    while (fillerEntries.length > 0 && fillerEntries[0] < fillerStart) fillerEntries.shift();

    // 4. Pauses — only count those within the rolling window
    const pauseStart = now - WINDOWS.PAUSE_SECONDS * 1000;
    const pauseEntries = pauseEntriesRef.current;
    while (pauseEntries.length > 0 && pauseEntries[0] < pauseStart) pauseEntries.shift();

    // 5. Real-time pause check — if currently in silence beyond threshold, record it now
    if (inSilenceRef.current && !pauseAlreadyCountedRef.current && silenceStartRef.current > 0) {
      const silenceDur = now - silenceStartRef.current;
      if (silenceDur > PAUSE_DURATION_MS) {
        pauseEntries.push(now);
        pauseAlreadyCountedRef.current = true;
      }
    }

    setMetrics({
      wpm,
      volume,
      fillerWords: fillerEntries.length,
      pauses: pauseEntries.length,
    });
  }, []);

  // ─── Pause analysis (freezes everything) ───
  const pauseAnalysis = useCallback(() => {
    if (!activeRef.current || analysisPausedRef.current) return;
    analysisPausedRef.current = true;
    pausedAtRef.current = Date.now();

    // Suspend the audio context so the worklet stops producing data
    if (audioContextRef.current && audioContextRef.current.state === 'running') {
      audioContextRef.current.suspend();
    }

    // If we were in a silence period when paused, don't count the paused time
    // We'll handle this on resume.

    // Stop metrics interval while paused
    if (metricsIntervalRef.current) {
      clearInterval(metricsIntervalRef.current);
      metricsIntervalRef.current = null;
    }

    // Hide in-progress partial transcript while paused.
    setPartialTranscript('');
    setIsTranscribing(false);
  }, []);

  // ─── Resume analysis ───
  const resumeAnalysis = useCallback(() => {
    if (!activeRef.current || !analysisPausedRef.current) return;
    analysisPausedRef.current = false;

    // Accumulate paused duration
    if (pausedAtRef.current) {
      pausedDurationRef.current += Date.now() - pausedAtRef.current;
      pausedAtRef.current = null;
    }

    // Reset silence tracking so the paused silence doesn't count as a speech pause
    inSilenceRef.current = false;
    silenceStartRef.current = 0;
    pauseAlreadyCountedRef.current = false;

    // Resume audio context
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }

    // Restart metrics interval
    metricsIntervalRef.current = setInterval(emitMetrics, METRICS.EMIT_INTERVAL_MS);
    setIsTranscribing(true);
  }, [emitMetrics]);

  // ─── Start analysis ───
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
    pcmCarryRef.current = new Uint8Array(0);
    lastPartialEmitRef.current = 0;
    startTimeRef.current = Date.now();
    setMetrics({ wpm: 0, volume: 0, fillerWords: 0, pauses: 0 });
    setTranscripts([]);
    setPartialTranscript('');

    try {
      // 1. Set up AudioContext at 16kHz for Transcribe
      const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);

      // 2. Load AudioWorklet for PCM capture
      await audioCtx.audioWorklet.addModule('/audio-capture-processor.js');
      const workletNode = new AudioWorkletNode(audioCtx, 'audio-capture-processor');
      workletNodeRef.current = workletNode;
      source.connect(workletNode);
      workletNode.connect(audioCtx.destination); // needed for worklet to process

      // 3. Audio stream for Transcribe
      const audioStream = createAudioStream(MAX_AUDIO_QUEUE_CHUNKS);
      audioStreamRef.current = audioStream;

      // 4. Pipe worklet output → Transcribe + volume/pause analysis
      workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (!activeRef.current || analysisPausedRef.current) return;
        const float32 = e.data;

        // ── Volume: Exponential Moving Average ──
        // EMA reacts quickly to changes while staying smooth —
        // the standard approach for live audio meters.
        let sum = 0;
        for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
        const rms = Math.sqrt(sum / float32.length);
        emaVolumeRef.current = EMA_ALPHA * rms + (1 - EMA_ALPHA) * emaVolumeRef.current;

        // ── Pause detection: real-time ──
        // Count a pause the *moment* silence exceeds the threshold,
        // not after the speaker resumes. This gives instant feedback.
        if (rms < SILENCE_THRESHOLD) {
          if (!inSilenceRef.current) {
            // Silence just started
            inSilenceRef.current = true;
            silenceStartRef.current = Date.now();
            pauseAlreadyCountedRef.current = false;
          } else if (!pauseAlreadyCountedRef.current) {
            // Still silent — check if we crossed the threshold right now
            const dur = Date.now() - silenceStartRef.current;
            if (dur > PAUSE_DURATION_MS) {
              pauseEntriesRef.current.push(Date.now());
              pauseAlreadyCountedRef.current = true;
              emitMetrics(); // push update immediately so UI reflects the pause
            }
          }
        } else {
          // Sound resumed — reset silence tracking
          inSilenceRef.current = false;
          pauseAlreadyCountedRef.current = false;
        }

        // ── Convert to PCM and aggregate into ~100ms chunks before sending ──
        const pcm = float32ToInt16(float32);
        pcmCarryRef.current = concatUint8Arrays(pcmCarryRef.current, pcm);

        while (pcmCarryRef.current.length >= TARGET_CHUNK_BYTES) {
          const chunk = pcmCarryRef.current.slice(0, TARGET_CHUNK_BYTES);
          audioStream.push(chunk);
          pcmCarryRef.current = pcmCarryRef.current.slice(TARGET_CHUNK_BYTES);
        }
      };

      // 5. Metrics refresh interval
      metricsIntervalRef.current = setInterval(emitMetrics, METRICS.EMIT_INTERVAL_MS);

      // 6. Get AWS credentials and start Transcribe
      const idToken = await getIdToken();
      const providerName = `cognito-idp.${cognitoConfig.region}.amazonaws.com/${cognitoConfig.userPoolId}`;

      const client = new TranscribeStreamingClient({
        region: cognitoConfig.region,
        credentials: fromCognitoIdentityPool({
          clientConfig: { region: cognitoConfig.region },
          identityPoolId: cognitoConfig.identityPoolId,
          logins: { [providerName]: idToken },
        }),
      });

      setIsTranscribing(true);

      const command = new StartStreamTranscriptionCommand({
        LanguageCode: TRANSCRIBE.LANGUAGE_CODE,
        MediaSampleRateHertz: SAMPLE_RATE,
        MediaEncoding: TRANSCRIBE.MEDIA_ENCODING,
        AudioStream: audioStream as AsyncIterable<{ AudioEvent: { AudioChunk: Uint8Array } }>,
      });

      const response = await client.send(command);

      // 7. Process Transcribe results
      if (response.TranscriptResultStream) {
        for await (const event of response.TranscriptResultStream) {
          if (!activeRef.current) break;

          // Skip processing transcript events while paused
          if (analysisPausedRef.current) continue;

          const results = event.TranscriptEvent?.Transcript?.Results;
          if (!results || results.length === 0) continue;

          const result = results[0];
          const text = result.Alternatives?.[0]?.Transcript ?? '';
          const isFinal = !result.IsPartial;

          if (isFinal && text.trim()) {
            const words = text.toLowerCase().trim().split(/\s+/);

            // Record timestamped word count for sliding-window WPM
            wordEntriesRef.current.push({ time: Date.now(), count: words.length });

            // Record timestamped filler word detections
            const ts = Date.now();
            words.forEach((w) => {
              const clean = w.replace(/[.,!?;:'"()\-]/g, '');
              if (FILLER_WORDS.includes(clean)) fillerEntriesRef.current.push(ts);
            });

            // Timestamp relative to effective speaking time
            const totalElapsed = Date.now() - startTimeRef.current;
            const effectiveMs = totalElapsed - pausedDurationRef.current;
            const elapsed = Math.max(0, Math.floor(effectiveMs / 1000));
            setTranscripts((prev) => [
              ...prev,
              { text: text.trim(), isFinal: true, timestamp: formatTime(elapsed) },
            ].slice(-MAX_TRANSCRIPT_ENTRIES));
            setPartialTranscript('');
            emitMetrics(); // immediate update on final result
          } else {
            // Throttle partial transcript state updates to avoid UI re-render pressure.
            const now = Date.now();
            if (now - lastPartialEmitRef.current >= PARTIAL_EMIT_INTERVAL_MS) {
              setPartialTranscript(text);
              lastPartialEmitRef.current = now;
            }
          }
        }
      }
    } catch (err) {
      console.error('Audio analysis error:', err);
      const msg = err instanceof Error ? err.message : 'Audio analysis failed';
      setError(msg);
    }
  }, [getIdToken, emitMetrics]);

  // ─── Stop analysis ───
  const stopAnalysis = useCallback(() => {
    activeRef.current = false;
    analysisPausedRef.current = false;
    setIsTranscribing(false);
    setPartialTranscript('');
    pcmCarryRef.current = new Uint8Array(0);

    // If we were tracking a silence when stopped, check if it counts
    if (inSilenceRef.current && silenceStartRef.current > 0) {
      const dur = Date.now() - silenceStartRef.current;
      if (dur > PAUSE_DURATION_MS && !pauseAlreadyCountedRef.current) {
        pauseEntriesRef.current.push(Date.now());
      }
      inSilenceRef.current = false;
    }

    // Stop worklet
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage('stop');
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    // End audio stream
    if (audioStreamRef.current) {
      audioStreamRef.current.end();
      audioStreamRef.current = null;
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

    // Final metrics emit
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
