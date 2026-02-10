// =============================================================================
// AWS Transcribe Streaming transcription provider
// =============================================================================
//
// Streams PCM audio to Amazon Transcribe via the AWS SDK v3.
// Requires:
//   - @aws-sdk/client-transcribe-streaming
//   - @aws-sdk/credential-providers
//   - A Cognito Identity Pool for credential exchange
//
// The provider creates its own AudioContext + AudioWorklet pipeline to
// capture 16 kHz Int16 PCM from the MediaStream and feeds it into the
// Transcribe SDK's async-iterable AudioStream.
// =============================================================================

import type { TranscriptionProvider, TranscriptionCallbacks } from './types';
import { TranscribeStreamingClient, StartStreamTranscriptionCommand } from '@aws-sdk/client-transcribe-streaming';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { cognitoConfig, AUDIO_ANALYSIS_CONFIG } from '../config/config';

// ── Helpers ──────────────────────────────────────────────────────────

/** Convert Float32 audio samples to Int16 PCM bytes */
function float32ToInt16(float32: Float32Array): Uint8Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Uint8Array(int16.buffer);
}

/** Concatenate two Uint8Arrays */
function concatUint8(a: Uint8Array<ArrayBufferLike>, b: Uint8Array<ArrayBufferLike>): Uint8Array {
  if (a.length === 0) return new Uint8Array(b);
  if (b.length === 0) return new Uint8Array(a);
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Push-based async iterable that the Transcribe SDK pulls audio from */
function createAudioStream(maxQueueChunks: number) {
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

// ── Provider implementation ──────────────────────────────────────────

export function createAwsTranscribeProvider(
  getIdToken: () => Promise<string>,
): TranscriptionProvider {
  let audioCtx: AudioContext | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let audioStream: ReturnType<typeof createAudioStream> | null = null;
  let active = false;
  let paused = false;
  let pcmCarry: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let callbacks: TranscriptionCallbacks | null = null;
  let lastPartialEmit = 0;

  const cfg = AUDIO_ANALYSIS_CONFIG.TRANSCRIPTION.AWS_TRANSCRIBE;

  return {
    name: 'AWS Transcribe',

    async start(stream: MediaStream, cbs: TranscriptionCallbacks) {
      callbacks = cbs;
      active = true;
      paused = false;
      pcmCarry = new Uint8Array(0);
      lastPartialEmit = 0;

      // 1. AudioContext at the sample rate Transcribe requires (16 kHz)
      audioCtx = new AudioContext({ sampleRate: cfg.SAMPLE_RATE });
      const source = audioCtx.createMediaStreamSource(stream);

      await audioCtx.audioWorklet.addModule('/audio-capture-processor.js');
      workletNode = new AudioWorkletNode(audioCtx, 'audio-capture-processor');
      source.connect(workletNode);
      workletNode.connect(audioCtx.destination);

      // 2. Async iterable audio feed
      const targetChunkBytes = Math.floor((cfg.SAMPLE_RATE * cfg.CHUNK_DURATION_MS) / 1000) * 2;
      audioStream = createAudioStream(cfg.MAX_AUDIO_QUEUE_CHUNKS);

      workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (!active || paused) return;
        const pcm = float32ToInt16(e.data);
        pcmCarry = concatUint8(pcmCarry, pcm);

        while (pcmCarry.length >= targetChunkBytes) {
          const chunk = pcmCarry.slice(0, targetChunkBytes);
          audioStream!.push(chunk);
          pcmCarry = pcmCarry.slice(targetChunkBytes);
        }
      };

      // 3. Obtain AWS credentials and start Transcribe
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

      const command = new StartStreamTranscriptionCommand({
        LanguageCode: cfg.LANGUAGE_CODE,
        MediaSampleRateHertz: cfg.SAMPLE_RATE,
        MediaEncoding: cfg.MEDIA_ENCODING,
        AudioStream: audioStream as AsyncIterable<{ AudioEvent: { AudioChunk: Uint8Array } }>,
      });

      const response = await client.send(command);

      // 4. Consume transcript result stream
      if (response.TranscriptResultStream) {
        for await (const event of response.TranscriptResultStream) {
          if (!active) break;
          if (paused) continue;

          const results = event.TranscriptEvent?.Transcript?.Results;
          if (!results || results.length === 0) continue;

          const result = results[0];
          const text = result.Alternatives?.[0]?.Transcript ?? '';
          const isFinal = !result.IsPartial;

          if (isFinal && text.trim()) {
            callbacks?.onFinalTranscript(text.trim());
          } else {
            const now = Date.now();
            if (now - lastPartialEmit >= AUDIO_ANALYSIS_CONFIG.TRANSCRIPT.PARTIAL_EMIT_INTERVAL_MS) {
              callbacks?.onPartialTranscript(text);
              lastPartialEmit = now;
            }
          }
        }
      }
    },

    pause() {
      paused = true;
      if (audioCtx && audioCtx.state === 'running') {
        audioCtx.suspend();
      }
    },

    resume() {
      paused = false;
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    },

    stop() {
      active = false;
      paused = false;
      pcmCarry = new Uint8Array(0);

      if (workletNode) {
        workletNode.port.postMessage('stop');
        workletNode.disconnect();
        workletNode = null;
      }

      if (audioStream) {
        audioStream.end();
        audioStream = null;
      }

      if (audioCtx && audioCtx.state !== 'closed') {
        audioCtx.close();
        audioCtx = null;
      }

      callbacks = null;
    },
  };
}
