// =============================================================================
// Transcription provider factory
// =============================================================================
//
// Reads AUDIO_ANALYSIS_CONFIG.TRANSCRIPTION.PROVIDER from config.ts and
// returns the matching provider instance.
//
// Usage:
//   import { createTranscriptionProvider } from '../transcription';
//   const provider = createTranscriptionProvider(getIdToken);
//   await provider.start(stream, callbacks);
//
// To switch engines, just change the PROVIDER value in config.ts — no other
// code needs to change.
// =============================================================================

export type { TranscriptionProvider, TranscriptionCallbacks } from './types';
export { createWebSpeechProvider } from './webSpeechProvider';
export { createAwsTranscribeProvider } from './awsTranscribeProvider';

import type { TranscriptionProvider } from './types';
import { createWebSpeechProvider } from './webSpeechProvider';
import { createAwsTranscribeProvider } from './awsTranscribeProvider';
import { AUDIO_ANALYSIS_CONFIG } from '../config/config';

/**
 * Create the transcription provider configured in AUDIO_ANALYSIS_CONFIG.
 *
 * @param getIdToken  Only required when the AWS Transcribe provider is active.
 *                    Pass `null` if you know you're using Web Speech.
 */
export function createTranscriptionProvider(
  getIdToken: (() => Promise<string>) | null,
): TranscriptionProvider {
  const providerKey = AUDIO_ANALYSIS_CONFIG.TRANSCRIPTION.PROVIDER;

  switch (providerKey) {
    case 'web-speech':
      return createWebSpeechProvider();

    case 'aws-transcribe': {
      if (!getIdToken) {
        throw new Error(
          'AWS Transcribe provider requires a getIdToken function (from AuthContext). ' +
          'Pass it when creating the provider, or switch to "web-speech" in config.',
        );
      }
      return createAwsTranscribeProvider(getIdToken);
    }

    default:
      throw new Error(`Unknown transcription provider: "${providerKey}". Expected "web-speech" or "aws-transcribe".`);
  }
}
