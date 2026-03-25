// =============================================================================
// Web Speech API transcription provider
// =============================================================================
//
// Uses the browser-native SpeechRecognition API (Chrome, Edge, Safari).
// Zero dependencies, zero AWS cost, fully client-side.
//
// Limitations:
//   - Chrome silently ends recognition after ~60 s of continuous speech;
//     we auto-restart in the `onend` handler.
//   - Accuracy and latency vary by browser / OS.
//   - Requires an internet connection on Chrome (audio is sent to Google).
// =============================================================================

import type { TranscriptionProvider, TranscriptionCallbacks } from './types';
import { AUDIO_ANALYSIS_CONFIG } from '../config/config';

// ── Minimal type shims (Web Speech API is not in default TS libs) ────
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    (new () => SpeechRecognitionInstance) | null;
}

// ── Provider implementation ──────────────────────────────────────────

export function createWebSpeechProvider(): TranscriptionProvider {
  let recognition: SpeechRecognitionInstance | null = null;
  let active = false;
  let paused = false;
  let callbacks: TranscriptionCallbacks | null = null;

  return {
    name: 'Web Speech API',

    async start(
      _stream: MediaStream,               // not used — the browser accesses the mic itself
      cbs: TranscriptionCallbacks,
    ) {
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) {
        throw new Error(
          'Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.',
        );
      }

      callbacks = cbs;
      active = true;
      paused = false;

      const rec = new Ctor();
      recognition = rec;

      const { WEB_SPEECH } = AUDIO_ANALYSIS_CONFIG.TRANSCRIPTION;
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = WEB_SPEECH.LANGUAGE_CODE;
      rec.maxAlternatives = 1;

      rec.onresult = (event: SpeechRecognitionEvent) => {
        if (!active || paused || !callbacks) return;

        let interimText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript ?? '';
          if (result.isFinal) {
            callbacks.onFinalTranscript(text);
          } else {
            interimText += text;
          }
        }
        if (interimText) {
          callbacks.onPartialTranscript(interimText);
        }
      };

      rec.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        console.error('WebSpeech error:', event.error, event.message);
        callbacks?.onError(`Speech recognition error: ${event.error}`);
      };

      // Auto-restart — Chrome kills sessions after ~60 s
      rec.onend = () => {
        if (active && !paused) {
          try { rec.start(); } catch { /* already running */ }
        }
      };

      rec.start();
    },

    pause() {
      paused = true;
      if (recognition) {
        try { recognition.abort(); } catch { /* ignore */ }
      }
    },

    resume() {
      paused = false;
      if (active && recognition) {
        try { recognition.start(); } catch { /* ignore */ }
      }
    },

    stop() {
      active = false;
      paused = false;
      if (recognition) {
        try { recognition.abort(); } catch { /* ignore */ }
        recognition = null;
      }
      callbacks = null;
    },
  };
}
