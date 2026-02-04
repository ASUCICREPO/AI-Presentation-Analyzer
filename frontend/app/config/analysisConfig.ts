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
      LOOK_UP: 0.6  // Replaces 0.3 default
    }
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
    }
  }
};
