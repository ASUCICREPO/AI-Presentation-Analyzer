// =============================================================================
// Centralized application configuration
// =============================================================================

// ---------------------------------------------------------------------------
// AWS Cognito — loaded from environment variables (.env.local)
// ---------------------------------------------------------------------------
export const cognitoConfig = {
  region: process.env.NEXT_PUBLIC_COGNITO_REGION!,
  userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
  userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID!,
  identityPoolId: process.env.NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID!,
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------
export interface Persona {
  personaID: string;
  name: string;
  description: string;
  personaPrompt?: string;
  expertise: string;
  keyPriorities: string[];
  attentionSpan: string;
  communicationStyle: string;
}


// ---------------------------------------------------------------------------
// Presentation Analysis
// ---------------------------------------------------------------------------
export const ANALYSIS_CONFIG = {
  // Blendshape thresholds for gaze detection
  // Higher values require more extreme head/eye movement to trigger "looking away"
  GAZE_THRESHOLDS: {
    LOOK_LEFT: 0.5,
    LOOK_RIGHT: 0.5,
    LOOK_UP: 0.3, // Lower threshold for looking up as it's often more subtle
    LOOK_DOWN: 0.5,
    // Dynamic thresholds for when user is surprised (eyes wide open)
    SURPRISE_MULTIPLIER: {
      GENERAL: 0.7, // Replaces 0.5 default
      LOOK_UP: 0.6, // Replaces 0.3 default
    },
  },

  // Timing configurations (in milliseconds)
  TIMING: {
    // How long the user must look away before an alert triggers
    LOOK_AWAY_THRESHOLD_MS: 3000,
    // How long the user must hold gaze at center to reset the alert state
    LOOK_BACK_THRESHOLD_MS: 500,
  },

  // Audio Feedback Configuration
  AUDIO: {
    ENABLED_BY_DEFAULT: true,
    FREQUENCY_START: 880, // Hz (A5)
    FREQUENCY_END: 880,   // Hz (A5) - Flat tone
    DURATION: 0.3,        // Seconds
    GAIN_START: 0.1,
    GAIN_END: 0.01,
  },

  // Performance Settings
  PERFORMANCE: {
    FPS_LIMIT: 30,
    get FRAME_INTERVAL() {
      return 1000 / this.FPS_LIMIT;
    },
  },
};

// ---------------------------------------------------------------------------
// Audio Analysis & Live Transcription
// ---------------------------------------------------------------------------
export const AUDIO_ANALYSIS_CONFIG = {
  // Words that count as fillers (used by both detection and UI highlighting)
  FILLER_WORDS: ['um', 'uh', 'like', 'actually', 'you know', 'basically', 'so', 'right', 'well'],

  // Transcribe streaming settings
  TRANSCRIBE: {
    SAMPLE_RATE: 16000,              // Hz — required by Amazon Transcribe
    LANGUAGE_CODE: 'en-US' as const,
    MEDIA_ENCODING: 'pcm' as const,
  },

  // PCM chunking — aggregate small worklet frames into larger chunks
  // before sending to Transcribe for lower overhead & latency.
  CHUNKING: {
    CHUNK_DURATION_MS: 100,          // ~100ms per chunk (Transcribe recommended)
    get TARGET_CHUNK_SAMPLES() {
      return Math.floor(
        (AUDIO_ANALYSIS_CONFIG.TRANSCRIBE.SAMPLE_RATE * this.CHUNK_DURATION_MS) / 1000,
      );
    },
    get TARGET_CHUNK_BYTES() {
      return this.TARGET_CHUNK_SAMPLES * 2; // Int16 PCM = 2 bytes/sample
    },
    MAX_AUDIO_QUEUE_CHUNKS: 20,      // ~2s max buffered before dropping stale chunks
  },

  // Silence / pause detection
  SILENCE: {
    THRESHOLD: 0.02,                 // RMS below this = silence
    PAUSE_DURATION_MS: 3000,         // Silence longer than this = counted pause
  },

  // Volume meter — Exponential Moving Average (EMA)
  // EMA reacts quickly to volume changes while staying smooth,
  // which is the standard approach for live audio meters.
  VOLUME: {
    EMA_ALPHA: 0.3,                  // Smoothing factor (0-1). Higher = more responsive.
    MAX_RMS: 0.06,                   // RMS value mapped to 100% volume
  },

  // Sliding windows — all counters use a rolling window so they
  // reflect what's happening *now*, not the entire session.
  WINDOWS: {
    PACE_SECONDS: 30,                // WPM computed from last 30s of speech
    FILLER_SECONDS: 30,              // Filler word count resets every 30s
    PAUSE_SECONDS: 30,               // Pause count resets every 30s
  },

  // Metrics refresh
  METRICS: {
    EMIT_INTERVAL_MS: 1000,          // Push metric state updates every 1s for responsiveness
  },

  // Transcript UI limits
  TRANSCRIPT: {
    MAX_ENTRIES: 200,                // Cap stored transcript entries
    PARTIAL_EMIT_INTERVAL_MS: 150,   // Throttle partial transcript re-renders
  },
};
