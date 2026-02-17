'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Volume2, X, AlertCircle, CheckCircle } from 'lucide-react';
import { WEBSOCKET_API_URL, QA_SESSION_CONFIG } from '../config/config';

interface QASessionProps {
  sessionId: string;
  userId: string;
  sessionDate: string;
  idToken: string;
  onClose: () => void;
}

interface Message {
  type: 'ai' | 'user' | 'system';
  text: string;
  timestamp: Date;
}

type SessionState = 'connecting' | 'ready' | 'ai_asking' | 'user_answering' | 'ai_responding' | 'ended' | 'error';

export default function QASession({ sessionId, userId, sessionDate, idToken, onClose }: QASessionProps) {
  // WebSocket connection
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>('connecting');
  const [error, setError] = useState<string | null>(null);

  // Session tracking
  const [questionsAsked, setQuestionsAsked] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);

  // Audio
  const [isRecording, setIsRecording] = useState(false);
  const [isAITalking, setIsAITalking] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(QA_SESSION_CONFIG.DEFAULT_VOICE_ID);

  // Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioQueueRef = useRef<Uint8Array[]>([]);
  const isPlayingRef = useRef(false);
  const sessionStartTimeRef = useRef<number>(Date.now());

  // Timer
  useEffect(() => {
    if (sessionState === 'ready' || sessionState === 'ai_asking' || sessionState === 'user_answering' || sessionState === 'ai_responding') {
      const interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - sessionStartTimeRef.current) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [sessionState]);

  // WebSocket connection
  useEffect(() => {
    const wsUrl = `${WEBSOCKET_API_URL}?token=${encodeURIComponent(idToken)}&sessionId=${encodeURIComponent(sessionId)}`;
    console.log('[QASession] Connecting to WebSocket:', wsUrl);

    const websocket = new WebSocket(wsUrl);
    wsRef.current = websocket;

    websocket.onopen = () => {
      console.log('[QASession] WebSocket connected');
      setSessionState('ready');
      setWs(websocket);

      // Start session
      websocket.send(JSON.stringify({
        type: 'session_start',
        config: {
          voiceId: selectedVoice,
          endpointingSensitivity: QA_SESSION_CONFIG.ENDPOINTING_SENSITIVITY,
        },
      }));
    };

    websocket.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      console.log('[QASession] Received:', data.type);

      switch (data.type) {
        case 'session_ready':
          addMessage('system', 'Session started! The AI will ask the first question.');
          setSessionState('ai_asking');
          setIsAITalking(true);
          break;

        case 'audio_output':
          // Queue audio for playback
          const audioData = Uint8Array.from(atob(data.audio), c => c.charCodeAt(0));
          audioQueueRef.current.push(audioData);
          playNextAudioChunk();
          break;

        case 'text_output':
          // Display AI question/response as text
          if (data.isFinal) {
            addMessage('ai', data.text);
          }
          break;

        case 'turn_end':
          setIsAITalking(false);
          setQuestionsAsked(QA_SESSION_CONFIG.MAX_QUESTIONS - (data.questionsRemaining || 0));

          if (data.waitingForAnswer) {
            setSessionState('user_answering');
            addMessage('system', 'Your turn to answer! Click the mic button.');
          } else {
            setSessionState('ai_responding');
          }
          break;

        case 'warning':
          addMessage('system', `⚠️ ${data.message}`);
          break;

        case 'session_limit_reached':
          addMessage('system', `🏁 ${data.message}`);
          setSessionState('ended');
          setTimeout(() => websocket.close(), 2000);
          break;

        case 'error':
          console.error('[QASession] Error:', data.message);
          setError(data.message);
          setSessionState('error');
          break;
      }
    };

    websocket.onerror = (event) => {
      console.error('[QASession] WebSocket error:', event);
      setError('WebSocket connection error');
      setSessionState('error');
    };

    websocket.onclose = () => {
      console.log('[QASession] WebSocket closed');
      setSessionState('ended');
    };

    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
      websocket.close();
    };
  }, [sessionId, userId, sessionDate, idToken, selectedVoice]);

  // Audio playback
  const playNextAudioChunk = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;

    isPlayingRef.current = true;
    const chunk = audioQueueRef.current.shift()!;

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: QA_SESSION_CONFIG.AUDIO.SAMPLE_RATE });
      }

      const context = audioContextRef.current;

      // Convert PCM to float32
      const floatData = new Float32Array(chunk.length / 2);
      for (let i = 0; i < floatData.length; i++) {
        const int16 = (chunk[i * 2 + 1] << 8) | chunk[i * 2];
        floatData[i] = int16 / 32768.0;
      }

      // Create audio buffer
      const audioBuffer = context.createBuffer(1, floatData.length, QA_SESSION_CONFIG.AUDIO.SAMPLE_RATE);
      audioBuffer.getChannelData(0).set(floatData);

      // Play
      const source = context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(context.destination);

      source.onended = () => {
        isPlayingRef.current = false;
        playNextAudioChunk(); // Play next chunk
      };

      source.start();
    } catch (error) {
      console.error('[QASession] Audio playback error:', error);
      isPlayingRef.current = false;
    }
  }, []);

  // Audio recording
  const startRecording = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('[QASession] WebSocket not ready');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const context = new AudioContext({ sampleRate: QA_SESSION_CONFIG.AUDIO.SAMPLE_RATE });
      audioContextRef.current = context;

      const source = context.createMediaStreamSource(stream);

      // Create audio worklet for processing
      await context.audioWorklet.addModule('/audio-processor.js');
      const workletNode = new AudioWorkletNode(context, 'audio-processor');
      audioWorkletNodeRef.current = workletNode;

      let sequence = 0;

      workletNode.port.onmessage = (event) => {
        if (event.data.type === 'audio') {
          const pcmData = event.data.audioData;
          const base64Audio = btoa(String.fromCharCode(...new Uint8Array(pcmData)));

          // Send to WebSocket
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'audio_chunk',
              audio: base64Audio,
              sequence: sequence++,
            }));
          }
        }
      };

      source.connect(workletNode);
      workletNode.connect(context.destination);

      setIsRecording(true);
      setSessionState('user_answering');
      addMessage('user', '[Recording...]');
    } catch (error) {
      console.error('[QASession] Recording error:', error);
      setError('Failed to access microphone');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    setIsRecording(false);

    // Send audio_end to backend
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'audio_end' }));
      setSessionState('ai_responding');
      setIsAITalking(true);

      // Remove recording placeholder
      setMessages(prev => prev.filter(m => m.text !== '[Recording...]'));
    }
  }, []);

  const addMessage = useCallback((type: 'ai' | 'user' | 'system', text: string) => {
    setMessages(prev => [...prev, { type, text, timestamp: new Date() }]);
  }, []);

  const handleEndSession = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'control', action: 'end_session' }));
    }
    onClose();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const isSessionLimitNear = () => {
    return questionsAsked >= QA_SESSION_CONFIG.QUESTION_WARNING_THRESHOLD ||
           elapsedTime >= QA_SESSION_CONFIG.TIME_WARNING_SEC;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-4xl h-[90vh] bg-white rounded-lg shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4 bg-maroon text-white">
          <div>
            <h2 className="text-2xl font-bold">Live Q&A Practice</h2>
            <p className="text-sm text-maroon-100">Simulate audience questions about your presentation</p>
          </div>
          <button
            onClick={handleEndSession}
            className="p-2 hover:bg-maroon-600 rounded-lg transition-colors"
            title="End session"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Stats Bar */}
        <div className="border-b px-6 py-3 bg-gray-50 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Questions:</span>
              <span className={`text-lg font-bold ${isSessionLimitNear() ? 'text-orange-600' : 'text-gray-900'}`}>
                {questionsAsked} / {QA_SESSION_CONFIG.MAX_QUESTIONS}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Time:</span>
              <span className={`text-lg font-bold ${isSessionLimitNear() ? 'text-orange-600' : 'text-gray-900'}`}>
                {formatTime(elapsedTime)} / {formatTime(QA_SESSION_CONFIG.MAX_DURATION_SEC)}
              </span>
            </div>
          </div>

          {/* Session Status */}
          <div className="flex items-center gap-2">
            {sessionState === 'connecting' && (
              <span className="text-sm text-gray-600 flex items-center gap-2">
                <div className="animate-spin w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full" />
                Connecting...
              </span>
            )}
            {sessionState === 'ai_asking' && (
              <span className="text-sm text-blue-600 flex items-center gap-2">
                <Volume2 className="w-4 h-4 animate-pulse" />
                AI is asking...
              </span>
            )}
            {sessionState === 'user_answering' && !isRecording && (
              <span className="text-sm text-green-600 flex items-center gap-2">
                <Mic className="w-4 h-4" />
                Your turn to answer
              </span>
            )}
            {isRecording && (
              <span className="text-sm text-red-600 flex items-center gap-2">
                <Mic className="w-4 h-4 animate-pulse" />
                Recording...
              </span>
            )}
            {sessionState === 'ai_responding' && (
              <span className="text-sm text-purple-600 flex items-center gap-2">
                <div className="animate-spin w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full" />
                AI is thinking...
              </span>
            )}
            {sessionState === 'ended' && (
              <span className="text-sm text-gray-600 flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Session ended
              </span>
            )}
            {sessionState === 'error' && (
              <span className="text-sm text-red-600 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Error
              </span>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-3 ${
                  message.type === 'ai'
                    ? 'bg-blue-100 text-blue-900'
                    : message.type === 'user'
                    ? 'bg-green-100 text-green-900'
                    : 'bg-gray-100 text-gray-700 text-center w-full'
                }`}
              >
                <div className="text-sm font-medium mb-1">
                  {message.type === 'ai' && '🤖 AI'}
                  {message.type === 'user' && '👤 You'}
                  {message.type === 'system' && '💬 System'}
                </div>
                <div className="text-sm whitespace-pre-wrap">{message.text}</div>
                <div className="text-xs mt-1 opacity-60">
                  {message.timestamp.toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}

          {isAITalking && (
            <div className="flex justify-start">
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                <div className="flex items-center gap-2 text-blue-600">
                  <Volume2 className="w-4 h-4 animate-pulse" />
                  <span className="text-sm">AI is speaking...</span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 text-red-600">
                <AlertCircle className="w-5 h-5" />
                <span className="text-sm font-medium">Error: {error}</span>
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="border-t px-6 py-4 bg-gray-50">
          <div className="flex items-center justify-center gap-4">
            {sessionState === 'user_answering' && !isRecording && (
              <button
                onClick={startRecording}
                className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
              >
                <Mic className="w-5 h-5" />
                Start Answering
              </button>
            )}

            {isRecording && (
              <button
                onClick={stopRecording}
                className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium animate-pulse"
              >
                <MicOff className="w-5 h-5" />
                Stop Recording
              </button>
            )}

            {(sessionState === 'ended' || sessionState === 'error') && (
              <button
                onClick={onClose}
                className="flex items-center gap-2 px-6 py-3 bg-maroon text-white rounded-lg hover:bg-maroon-600 transition-colors font-medium"
              >
                Close Session
              </button>
            )}
          </div>

          {sessionState === 'user_answering' && (
            <p className="text-center text-sm text-gray-600 mt-3">
              Click "Start Answering" to respond to the AI's question
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
