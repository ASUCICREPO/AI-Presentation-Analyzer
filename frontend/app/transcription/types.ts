// =============================================================================
// Shared interface for all transcription providers
// =============================================================================
//
// Each provider must implement this contract so the useAudioAnalysis hook
// can treat them interchangeably.  To add a new engine (e.g. Deepgram,
// Whisper-via-WebSocket, etc.) just create a new file that satisfies this
// interface and register it in ./index.ts.
// =============================================================================

export interface TranscriptionCallbacks {
  /** Called with each finalised transcript segment */
  onFinalTranscript: (text: string) => void;
  /** Called with in-progress (interim) text for live "typing" display */
  onPartialTranscript: (text: string) => void;
  /** Called when a non-recoverable error occurs */
  onError: (message: string) => void;
}

export interface TranscriptionProvider {
  /** Human-readable name shown in logs / debug UI */
  readonly name: string;

  /**
   * Start the transcription engine.
   *
   * @param stream  The MediaStream from getUserMedia (contains the audio track).
   * @param callbacks  Hooks into the parent component's state.
   * @returns A promise that resolves once the engine is up and producing results.
   *          For streaming providers the promise resolves immediately after the
   *          connection is established; the provider keeps running in the background.
   */
  start(stream: MediaStream, callbacks: TranscriptionCallbacks): Promise<void>;

  /** Pause / freeze transcription (may be a no-op for some providers) */
  pause(): void;

  /** Resume after a pause */
  resume(): void;

  /** Tear everything down — called once at the end of a session */
  stop(): void;
}
