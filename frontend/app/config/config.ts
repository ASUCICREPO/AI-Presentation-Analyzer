// =============================================================================
// Centralized application configuration
// =============================================================================
//
// IMPORTANT: When deployed to AWS Amplify, the following environment variables
// are automatically injected at build time by the CDK stack (backend/lib/backend-stack.ts):
//   - NEXT_PUBLIC_COGNITO_REGION
//   - NEXT_PUBLIC_COGNITO_USER_POOL_ID
//   - NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID
//   - NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID
//   - NEXT_PUBLIC_API_BASE_URL
//   - NEXT_PUBLIC_WEBSOCKET_API_URL
//
// For local development, these values are loaded from frontend/.env.local
// =============================================================================

// ---------------------------------------------------------------------------
// AWS Cognito — loaded from environment variables (.env.local or Amplify)
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
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// WebSocket (Live Q&A)
// ---------------------------------------------------------------------------
export const WEBSOCKET_URL = process.env.NEXT_PUBLIC_WEBSOCKET_API_URL!;

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------
export interface PersonaBestPractices {
  wpm: { min: number; max: number; label?: string };
  eyeContact: { min: number; label?: string };
  fillerWords: { max: number; label?: string };
  pauses: { min: number; label?: string };
}

export interface PersonaScoringWeights {
  pace: number;
  eyeContact: number;
  fillerWords: number;
  pauses: number;
}

export interface Persona {
  personaID: string;
  name: string;
  description: string;
  /**
   * SVG icon name used in the persona card UI.
   * Must match a key in the PERSONA_ICON_REGISTRY (see PersonaCard.tsx).
   * Stored in the DynamoDB personas table as a string.
   * Examples: "briefcase", "people", "school", "mic", "lightbulb"
   */
  icon?: string;
  personaPrompt?: string;
  expertise: string;
  keyPriorities: string[];
  presentationTime: string;
  communicationStyle: string;
  timeLimitSec?: number;
  qaTimeLimitSec?: number;
  bestPractices?: PersonaBestPractices;
  scoringWeights?: PersonaScoringWeights;
}

/** Sort order for expertise levels (lower = displayed first) */
export const EXPERTISE_ORDER: Record<string, number> = {
  beginner: 0,
  intermediate: 1,
  expert: 2,
};

/** Fallback icon name when a persona has no icon field set */
export const DEFAULT_PERSONA_ICON = 'people';

/** Fallback when a persona has no timeLimitSec set */
export const DEFAULT_TIME_LIMIT_SEC = 15 * 60; // 15 minutes

/** Fallback when a persona has no qaTimeLimitSec set */
export const DEFAULT_QA_TIME_LIMIT_SEC = 5 * 60; // 5 minutes

/** Generic defaults used when a persona has no bestPractices set.
 *
 * Sources:
 *  - WPM: 140-160 is the recommended range for professional presentations
 *    (Quantified Communications; The Speaker Lab). Research shows comprehension
 *    is unaffected within 130-190 wpm (Presentation Rate in Comprehension,
 *    Perceptual & Motor Skills, 2001).
 *  - Eye contact: 3.2s average preferred gaze duration per person (Vision
 *    Sciences Society, 2015). For a seated audience, maintaining gaze toward
 *    the camera/audience ~60-70% of the time is considered engaged delivery.
 *  - Filler words: Average speakers use ~5 fillers/min; optimal is ≤1/min
 *    (Quantified Communications). Per 30-second window ≤3 is a strong target.
 *  - Pauses: Deliberate 2-3s pauses after major points increased recall from
 *    42% to 71% (Maptive/SpeakingTimeCalculator). Avg speaker uses ~3.5
 *    pauses/min; great speakers use more. ≥4 per 30s window ≈ 8/min.
 */
export const DEFAULT_BEST_PRACTICES: PersonaBestPractices = {
  wpm: { min: 140, max: 160 },
  eyeContact: { min: 60 },
  fillerWords: { max: 3 },
  pauses: { min: 4 },
};

/** Generic scoring weights (must sum to 1.0) */
export const DEFAULT_SCORING_WEIGHTS: PersonaScoringWeights = {
  pace: 0.25,
  eyeContact: 0.30,
  fillerWords: 0.20,
  pauses: 0.25,
};

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
  MAX_WORDS: 500,                         // Max words allowed in custom notes
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
  QA_SESSION: 'qa_session.json',
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
  /** Interval (ms) between video chunk uploads — 90 seconds.
   *  At typical 640×480 webcam bitrate (~500 kbps–1 Mbps),
   *  90s produces ~5.6–11.25 MB, safely above the 5 MB S3 minimum. */
  CHUNK_INTERVAL_MS: 90_000,
  /** MediaRecorder MIME type (WebM is the standard for browser recording —
   *  MP4/H.264 has limited MediaRecorder support and requires a moov atom
   *  at EOF which breaks chunked streaming) */
  MIME_TYPE: 'video/webm;codecs=vp8,opus',
  /** Fallback MIME if preferred isn't supported */
  FALLBACK_MIME_TYPE: 'video/webm',
  /** Safari only supports MP4 via MediaRecorder */
  SAFARI_MIME_TYPE: 'video/mp4',
  /** MediaRecorder timeslice (ms) — push data every 1s into buffer */
  TIMESLICE_MS: 1_000,
  /** S3 multipart minimum part size (5 MB). Parts below this can't be uploaded
   *  except as the final part. The 60s interval ensures each chunk clears this. */
  MIN_PART_SIZE_BYTES: 5 * 1024 * 1024,
};


// ---------------------------------------------------------------------------
// QA Session
// ---------------------------------------------------------------------------
export const QA_SESSION_CONFIG = {
  DURATION_SEC: 300, // 5 minutes
  AUDIO_SAMPLE_RATE: 16000,
  AUDIO_CHANNELS: 1,
  AUDIO_FORMAT: 'pcm',
  /** Interval (ms) to send audio chunks to WebSocket */
  AUDIO_CHUNK_INTERVAL_MS: 100,
  /** Reconnection settings */
  RECONNECT_MAX_ATTEMPTS: 3,
  RECONNECT_BASE_DELAY_MS: 1000,
  /** Warning thresholds (seconds remaining) */
  WARNING_AT_SEC: 60,
  FINAL_WARNING_AT_SEC: 10,
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
  // Toggle real-time feedback panel during practice sessions.
  // When false, the right-hand metrics panel is hidden and the camera
  // view expands to full width — analytics are still collected for S3.
  SHOW_REALTIME_FEEDBACK: true,

  // Blendshape thresholds for gaze detection
  // Higher values require more extreme head/eye movement to trigger "looking away"
  GAZE_THRESHOLDS: {
    LOOK_LEFT: 0.6,
    LOOK_RIGHT: 0.4,
    LOOK_UP: 0.45,
    LOOK_DOWN: 0.6,
    // Dynamic thresholds for when user is surprised (eyes wide open)
    SURPRISE_MULTIPLIER: {
      GENERAL: 0.8,
      LOOK_UP: 0.7,
    },
  },

  // Timing configurations (in milliseconds)
  TIMING: {
    // How long the user must look away before an alert triggers
    LOOK_AWAY_THRESHOLD_MS: 5000,
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
