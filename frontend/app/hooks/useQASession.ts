import { useState, useRef, useCallback, useEffect } from 'react';
import { QAWebSocketClient, QAWebSocketConfig, QAWebSocketEvent, QATranscriptEntry } from '../services/websocket';
import { QA_SESSION_CONFIG } from '../config/config';

export type QASessionStatus = 'idle' | 'connecting' | 'active' | 'ending' | 'ended' | 'error';

export interface QASessionState {
  status: QASessionStatus;
  timer: number;
  personaName: string;
  transcriptEntries: QATranscriptEntry[];
  partialUserText: string;
  partialAssistantText: string;
  error: string | null;
  isMuted: boolean;
}

export interface UseQASessionReturn extends QASessionState {
  startSession: () => Promise<void>;
  endSession: () => void;
  toggleMute: () => void;
}

export function useQASession(
  config: QAWebSocketConfig,
  getToken?: () => Promise<string>,
): UseQASessionReturn {
  const [status, setStatus] = useState<QASessionStatus>('idle');
  const [timer, setTimer] = useState(0);
  const [personaName, setPersonaName] = useState('');
  const [transcriptEntries, setTranscriptEntries] = useState<QATranscriptEntry[]>([]);
  const [partialUserText, setPartialUserText] = useState('');
  const [partialAssistantText, setPartialAssistantText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  const wsClientRef = useRef<QAWebSocketClient | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorNodeRef = useRef<AudioWorkletNode | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMutedRef = useRef(false);

  // Audio playback queue
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);

  // Handle incoming WebSocket events
  const handleEvent = useCallback((event: QAWebSocketEvent) => {
    switch (event.type) {
      case 'session_started':
        setStatus('active');
        setPersonaName((event.persona_name as string) || '');
        break;

      case 'audio':
        // Queue audio for playback
        if (event.data) {
          const pcmBytes = Uint8Array.from(atob(event.data as string), c => c.charCodeAt(0));
          const int16 = new Int16Array(pcmBytes.buffer);
          const float32 = new Float32Array(int16.length);
          for (let i = 0; i < int16.length; i++) {
            float32[i] = int16[i] / 32768;
          }
          playbackQueueRef.current.push(float32);
          drainPlaybackQueue();
        }
        break;

      case 'transcript': {
        const role = event.role as 'user' | 'assistant';
        const text = event.text as string;
        const isPartial = event.is_partial as boolean;

        if (isPartial) {
          if (role === 'user') setPartialUserText(text);
          else setPartialAssistantText(text);
        } else {
          if (role === 'user') setPartialUserText('');
          else setPartialAssistantText('');
          if (text.trim()) {
            setTranscriptEntries(prev => [...prev, { role, text, is_partial: false }]);
          }
        }
        break;
      }

      case 'interruption':
        // Clear playback queue on interruption
        playbackQueueRef.current = [];
        break;

      case 'session_ended':
        setStatus('ended');
        stopAudioCapture();
        stopTimer();
        break;

      case 'error':
        setError((event.message as string) || 'Unknown error');
        setStatus('error');
        break;
    }
  }, []);

  // Audio playback
  const drainPlaybackQueue = useCallback(() => {
    if (isPlayingRef.current || playbackQueueRef.current.length === 0) return;
    isPlayingRef.current = true;

    const ctx = playbackContextRef.current || new AudioContext({ sampleRate: QA_SESSION_CONFIG.AUDIO_SAMPLE_RATE });
    playbackContextRef.current = ctx;

    const playNext = () => {
      const chunk = playbackQueueRef.current.shift();
      if (!chunk) {
        isPlayingRef.current = false;
        return;
      }
      const buffer = ctx.createBuffer(1, chunk.length, QA_SESSION_CONFIG.AUDIO_SAMPLE_RATE);
      buffer.copyToChannel(new Float32Array(chunk), 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = playNext;
      source.start();
    };
    playNext();
  }, []);

  // Timer
  const startTimer = useCallback(() => {
    setTimer(0);
    timerIntervalRef.current = setInterval(() => {
      setTimer(prev => {
        if (prev >= QA_SESSION_CONFIG.DURATION_SEC) {
          return prev;
        }
        return prev + 1;
      });
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  // Audio capture
  const startAudioCapture = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: QA_SESSION_CONFIG.AUDIO_SAMPLE_RATE,
        channelCount: QA_SESSION_CONFIG.AUDIO_CHANNELS,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    mediaStreamRef.current = stream;

    const ctx = new AudioContext({ sampleRate: QA_SESSION_CONFIG.AUDIO_SAMPLE_RATE });
    audioContextRef.current = ctx;

    const source = ctx.createMediaStreamSource(stream);

    // Use AudioWorkletNode (modern replacement for ScriptProcessorNode) for PCM access
    const workletCode = `
      class PCMProcessor extends AudioWorkletProcessor {
        process(inputs) {
          const input = inputs[0];
          if (!input || input.length === 0) {
            return true;
          }
          const channelData = input[0];
          if (!channelData) {
            return true;
          }
          const int16 = new Int16Array(channelData.length);
          for (let i = 0; i < channelData.length; i++) {
            const s = Math.max(-1, Math.min(1, channelData[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          this.port.postMessage(int16.buffer, [int16.buffer]);
          return true;
        }
      }
      registerProcessor('pcm-processor', PCMProcessor);
    `;

    const workletBlob = new Blob([workletCode], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(workletBlob);
    await ctx.audioWorklet.addModule(workletUrl);

    const processor = new AudioWorkletNode(ctx, 'pcm-processor');
    processorNodeRef.current = processor;

    processor.port.onmessage = (event) => {
      if (isMutedRef.current) return;
      const buffer = event.data as ArrayBuffer;
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      wsClientRef.current?.sendAudio(base64);
    };

    source.connect(processor);
    processor.connect(ctx.destination);
  }, []);

  const stopAudioCapture = useCallback(() => {
    processorNodeRef.current?.disconnect();
    processorNodeRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    mediaStreamRef.current = null;
    playbackContextRef.current?.close();
    playbackContextRef.current = null;
    playbackQueueRef.current = [];
    isPlayingRef.current = false;
  }, []);

  // Session lifecycle
  const startSession = useCallback(async () => {
    setStatus('connecting');
    setError(null);
    setTranscriptEntries([]);
    setPartialUserText('');
    setPartialAssistantText('');

    try {
      if (!getToken) {
        throw new Error('getToken function is required for authentication');
      }
      
      const client = new QAWebSocketClient(
        { ...config, getIdToken: getToken },
        handleEvent
      );
      wsClientRef.current = client;
      await client.connect();
      await startAudioCapture();
      client.startSession();
      startTimer();
    } catch (e) {
      console.error('[useQASession] Failed to start:', e);
      setError('Failed to connect to QA session');
      setStatus('error');
    }
  }, [config, getToken, handleEvent, startAudioCapture, startTimer]);

  const endSession = useCallback(() => {
    setStatus('ending');
    wsClientRef.current?.endSession();
    stopAudioCapture();
    stopTimer();
    // Allow time for the server to respond with session_ended
    setTimeout(() => {
      wsClientRef.current?.disconnect();
      wsClientRef.current = null;
      setStatus('ended');
    }, 1000);
  }, [stopAudioCapture, stopTimer]);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      isMutedRef.current = !prev;
      return !prev;
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsClientRef.current?.disconnect();
      stopAudioCapture();
      stopTimer();
    };
  }, [stopAudioCapture, stopTimer]);

  return {
    status,
    timer,
    personaName,
    transcriptEntries,
    partialUserText,
    partialAssistantText,
    error,
    isMuted,
    startSession,
    endSession,
    toggleMute,
  };
}
