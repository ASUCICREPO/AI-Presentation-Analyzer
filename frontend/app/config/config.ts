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
  timeLimitSec?: number; // Per-persona presentation time limit (seconds)
}

/** Fallback when a persona has no timeLimitSec set */
export const DEFAULT_TIME_LIMIT_SEC = 15 * 60; // 15 minutes

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
/** Generate a unique session ID for a new practice session. */
export function generateSessionId(): string {
  return `session_${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Persona Customization
// ---------------------------------------------------------------------------
export const PERSONA_CUSTOMIZATION = {
  MAX_WORDS: 100,                         // Max words allowed in custom notes
  MAX_BYTES: 10 * 1024,                   // 10 KB backend limit
  S3_FILENAME: 'CUSTOM_PERSONA_INSTRUCTION.txt',
};

// ---------------------------------------------------------------------------
// S3 Upload — fixed file names (no UUIDs, overwrites on re-upload)
// ---------------------------------------------------------------------------
export const S3_FILENAMES = {
  PRESENTATION: 'presentation.pdf',
  RECORDING: 'recording.webm',
  ANALYTICS: 'analytics.json',
  PERSONA_CUSTOMIZATION: PERSONA_CUSTOMIZATION.S3_FILENAME,
  TRANSCRIPT: 'transcript.json',
  SESSION_ANALYTICS: 'session_analytics.json',
  DETAILED_METRICS: 'detailed_metrics.json',
  MANIFEST: 'manifest.json',
};

/** Valid request types for the presigned URL endpoint */
export type S3RequestType =
  | 'ppt'
  | 'session'
  | 'metric_chunk'
  | 'persona_customization'
  | 'transcript'
  | 'session_analytics'
  | 'detailed_metrics'
  | 'manifest';

// ---------------------------------------------------------------------------
// Video Recording (multipart upload)
// ---------------------------------------------------------------------------
export const VIDEO_RECORDING_CONFIG = {
  /** Interval (ms) between video chunk uploads — 30 seconds */
  CHUNK_INTERVAL_MS: 30_000,
  /** MediaRecorder MIME type */
  MIME_TYPE: 'video/webm;codecs=vp8,opus',
  /** Fallback MIME if preferred isn't supported */
  FALLBACK_MIME_TYPE: 'video/webm',
  /** MediaRecorder timeslice (ms) — push data every 1s into buffer */
  TIMESLICE_MS: 1_000,
  /** Minimum chunk size in bytes before we bother uploading a part (5 MB — S3 minimum) */
  MIN_PART_SIZE_BYTES: 5 * 1024 * 1024,
};


// ---------------------------------------------------------------------------
// Presentation Time Limits (seconds)
// ---------------------------------------------------------------------------
export const PRESENTATION_LIMITS = {
  MAX_DURATION_SEC: DEFAULT_TIME_LIMIT_SEC,                 // Default cap (overridden per-persona)
  WARNING_REMAINING_SEC: 5 * 60,                           // DEMO: alert at 5s in (real: 5 * 60)
  FINAL_WARNING_REMAINING_SEC: 1 * 60,                     // DEMO: alert at 10s in (real: 1 * 60)
  get WARNING_AT_SEC() {
    return this.MAX_DURATION_SEC - this.WARNING_REMAINING_SEC;
  },
  get FINAL_WARNING_SEC() {
    return this.MAX_DURATION_SEC - this.FINAL_WARNING_REMAINING_SEC;
  },
  ALERT_DISPLAY_MS: 6000,                              // How long each toast stays visible
};

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

  // ─── Transcription provider ──────────────────────────────────────────
  // Change PROVIDER to switch engines.  All provider-specific settings
  // live under their own key so both can coexist in the config file.
  TRANSCRIPTION: {
    /** 'web-speech' — browser-native, zero cost, no AWS credentials needed.
     *                  NOTE: May not capture filler words (um, uh, err) — Google's
     *                  backend speech engine tends to filter out disfluencies, which
     *                  means filler word detection may not work with this provider.
     *  'aws-transcribe' — Amazon Transcribe Streaming via Cognito credentials.
     *                     Reliably captures filler words / disfluencies. */
    PROVIDER: 'aws-transcribe' as 'web-speech' | 'aws-transcribe',

    // Settings for the Web Speech API provider
    WEB_SPEECH: {
      LANGUAGE_CODE: 'en-US',
      /** AudioContext sample rate for the volume/pause worklet (not used by SpeechRecognition itself) */
      SAMPLE_RATE: 16000,
    },

    // Settings for the AWS Transcribe Streaming provider
    AWS_TRANSCRIBE: {
      SAMPLE_RATE: 16000,                // Hz — required by Amazon Transcribe
      LANGUAGE_CODE: 'en-US' as const,
      MEDIA_ENCODING: 'pcm' as const,
      CHUNK_DURATION_MS: 100,            // ~100 ms per chunk (Transcribe recommended)
      MAX_AUDIO_QUEUE_CHUNKS: 20,        // ~2 s max buffered before dropping stale chunks
    },
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
