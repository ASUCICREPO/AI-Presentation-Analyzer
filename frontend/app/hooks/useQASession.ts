import { useState, useRef, useCallback, useEffect } from 'react';
import { QAWebSocketClient, QAWebSocketConfig, QAWebSocketEvent, QATranscriptEntry } from '../services/websocket';
import { QA_SESSION_CONFIG } from '../config/config';
import { QAAnalyticsResponse } from '../services/api';

export type AgentState = null | 'thinking' | 'listening' | 'talking';

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
  agentState: AgentState;
  botAudioTrack: MediaStreamTrack | null;
  qaAnalytics: QAAnalyticsResponse | null;
}

export interface UseQASessionReturn extends QASessionState {
  startSession: () => Promise<void>;
  endSession: () => Promise<QAAnalyticsResponse | null>;
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
  const [agentState, setAgentState] = useState<AgentState>(null);
  const [botAudioTrack, setBotAudioTrack] = useState<MediaStreamTrack | null>(null);
  const [qaAnalytics, setQaAnalytics] = useState<QAAnalyticsResponse | null>(null);

  const wsClientRef = useRef<QAWebSocketClient | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorNodeRef = useRef<AudioWorkletNode | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMutedRef = useRef(false);
  const startTimerRef = useRef<(() => void) | null>(null);
  const safetyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Promise-based analytics delivery: endSession() returns a promise that
  // resolves when qa_analytics arrives (or on timeout / session_ended).
  // The WS client ref is deliberately NOT cleaned up on unmount while
  // this promise is pending — the safety timeout handles final cleanup.
  const analyticsResolveRef = useRef<((v: QAAnalyticsResponse | null) => void) | null>(null);
  const analyticsReceivedRef = useRef<QAAnalyticsResponse | null>(null);
  const endingRef = useRef(false);

  // Audio playback queue
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const playbackGainRef = useRef<GainNode | null>(null);
  const playbackQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);

  // Handle incoming WebSocket events
  const handleEvent = useCallback((event: QAWebSocketEvent) => {
    switch (event.type) {
      case 'session_started':
        setStatus('active');
        setPersonaName((event.persona_name as string) || '');
        setAgentState('listening');
        startTimerRef.current?.();
        break;

      case 'audio':
        if (event.data && !endingRef.current) {
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
          if (role === 'user') {
            setPartialUserText('');
            if (!isPlayingRef.current) setAgentState('thinking');
          } else {
            setPartialAssistantText('');
          }
          if (text.trim()) {
            setTranscriptEntries(prev => [...prev, { role, text, is_partial: false }]);
          }
        }
        break;
      }

      case 'interruption':
        playbackQueueRef.current = [];
        setAgentState('listening');
        break;

      case 'qa_analytics':
        console.log('[useQASession] Received qa_analytics from server');
        analyticsReceivedRef.current = event as unknown as QAAnalyticsResponse;
        setQaAnalytics(analyticsReceivedRef.current);
        if (analyticsResolveRef.current) {
          analyticsResolveRef.current(analyticsReceivedRef.current);
          analyticsResolveRef.current = null;
        }
        break;

      case 'session_ended':
        console.log('[useQASession] session_ended — analytics received:', !!analyticsReceivedRef.current);
        if (safetyTimeoutRef.current) {
          clearTimeout(safetyTimeoutRef.current);
          safetyTimeoutRef.current = null;
        }
        if (analyticsResolveRef.current) {
          analyticsResolveRef.current(analyticsReceivedRef.current);
          analyticsResolveRef.current = null;
        }
        wsClientRef.current?.disconnect();
        wsClientRef.current = null;
        endingRef.current = false;
        setStatus('ended');
        setAgentState(null);
        stopAudioCapture();
        stopTimer();
        break;

      case 'error':
        setError((event.message as string) || 'Unknown error');
        setStatus('error');
        setAgentState(null);
        break;
    }
  }, []);

  // Audio playback
  const drainPlaybackQueue = useCallback(() => {
    if (isPlayingRef.current || playbackQueueRef.current.length === 0) return;
    isPlayingRef.current = true;
    setAgentState('talking');

    const ctx = playbackContextRef.current || new AudioContext({ sampleRate: QA_SESSION_CONFIG.AUDIO_SAMPLE_RATE });
    playbackContextRef.current = ctx;

    if (!playbackDestRef.current) {
      const dest = ctx.createMediaStreamDestination();
      playbackDestRef.current = dest;
      setBotAudioTrack(dest.stream.getAudioTracks()[0] ?? null);
    }
    if (!playbackGainRef.current) {
      const gain = ctx.createGain();
      gain.gain.value = 1;
      gain.connect(ctx.destination);
      gain.connect(playbackDestRef.current);
      playbackGainRef.current = gain;
    }

    const gainNode = playbackGainRef.current;

    const playNext = () => {
      const chunk = playbackQueueRef.current.shift();
      if (!chunk) {
        isPlayingRef.current = false;
        setAgentState('listening');
        return;
      }
      const buffer = ctx.createBuffer(1, chunk.length, QA_SESSION_CONFIG.AUDIO_SAMPLE_RATE);
      buffer.copyToChannel(new Float32Array(chunk), 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gainNode);
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

  // Keep ref in sync so handleEvent (defined earlier) can call it
  startTimerRef.current = startTimer;

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
    playbackGainRef.current?.disconnect();
    playbackGainRef.current = null;
    playbackDestRef.current = null;
    setBotAudioTrack(null);
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
        config,
        handleEvent
      );
      wsClientRef.current = client;
      await client.connect();
      await startAudioCapture();
      // No startSession() call — the agent starts automatically after
      // the setup message sent in connect()'s onopen handler.
    } catch (e) {
      console.error('[useQASession] Failed to start:', e);
      setError('Failed to connect to QA session');
      setStatus('error');
    }
  }, [config, getToken, handleEvent, startAudioCapture, startTimer]);

  const endSession = useCallback((): Promise<QAAnalyticsResponse | null> => {
    setStatus('ending');
    endingRef.current = true;

    playbackQueueRef.current = [];
    isPlayingRef.current = false;
    if (playbackGainRef.current) {
      playbackGainRef.current.gain.value = 0;
      playbackGainRef.current.disconnect();
    }

    wsClientRef.current?.endSession();
    stopAudioCapture();
    stopTimer();

    return new Promise<QAAnalyticsResponse | null>((resolve) => {
      analyticsResolveRef.current = resolve;

      safetyTimeoutRef.current = setTimeout(() => {
        if (analyticsResolveRef.current) {
          analyticsResolveRef.current(analyticsReceivedRef.current);
          analyticsResolveRef.current = null;
        }
        wsClientRef.current?.disconnect();
        wsClientRef.current = null;
        endingRef.current = false;
        setStatus('ended');
      }, 30_000);
    });
  }, [stopAudioCapture, stopTimer]);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      isMutedRef.current = !prev;
      return !prev;
    });
  }, []);

  // Cleanup on unmount — skip WS disconnect if ending (safety timeout owns it)
  useEffect(() => {
    return () => {
      if (!endingRef.current) {
        if (safetyTimeoutRef.current) clearTimeout(safetyTimeoutRef.current);
        wsClientRef.current?.disconnect();
      }
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
    agentState,
    botAudioTrack,
    qaAnalytics,
    startSession,
    endSession,
    toggleMute,
  };
}
