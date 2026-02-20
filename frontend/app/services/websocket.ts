import { WEBSOCKET_URL, QA_SESSION_CONFIG, cognitoConfig } from '../config/config';
import { signWebSocketUrl } from './websocketSigner';
import { getAwsCredentials } from './awsCredentials';

export interface QAWebSocketConfig {
  personaId: string;
  sessionId: string;
  userId: string;
  dateStr: string;
  voiceId?: string;
  getIdToken: () => Promise<string>;
}

export interface QATranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
  is_partial: boolean;
  timestamp?: string;
}

export type QAWebSocketEventType =
  | 'session_started'
  | 'audio'
  | 'transcript'
  | 'interruption'
  | 'session_ended'
  | 'error';

export interface QAWebSocketEvent {
  type: QAWebSocketEventType;
  [key: string]: unknown;
}

export type QAWebSocketEventHandler = (event: QAWebSocketEvent) => void;

export class QAWebSocketClient {
  private ws: WebSocket | null = null;
  private config: QAWebSocketConfig;
  private eventHandler: QAWebSocketEventHandler;
  private reconnectAttempts = 0;
  private _isConnected = false;

  constructor(config: QAWebSocketConfig, onEvent: QAWebSocketEventHandler) {
    this.config = config;
    this.eventHandler = onEvent;
  }

  get isConnected(): boolean {
    return this._isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    try {
      // Get temporary AWS credentials from Cognito Identity Pool
      const credentials = await getAwsCredentials(this.config.getIdToken);
      
      // Build base URL with custom headers as query parameters
      // AgentCore accepts custom headers with prefix: X-Amzn-Bedrock-AgentCore-Runtime-Custom-
      const baseUrl = new URL(WEBSOCKET_URL);
      
      // Session ID (standard header, not custom)
      baseUrl.searchParams.set('X-Amzn-Bedrock-AgentCore-Runtime-Session-Id', this.config.sessionId);
      
      // Custom headers for persona configuration
      baseUrl.searchParams.set('X-Amzn-Bedrock-AgentCore-Runtime-Custom-PersonaId', this.config.personaId);
      baseUrl.searchParams.set('X-Amzn-Bedrock-AgentCore-Runtime-Custom-UserId', this.config.userId);
      baseUrl.searchParams.set('X-Amzn-Bedrock-AgentCore-Runtime-Custom-DateStr', this.config.dateStr);
      
      if (this.config.voiceId) {
        baseUrl.searchParams.set('X-Amzn-Bedrock-AgentCore-Runtime-Custom-VoiceId', this.config.voiceId);
      }
      
      // Sign the URL with SigV4 (adds AWS signature query parameters)
      const signedUrl = await signWebSocketUrl(
        baseUrl.toString(),
        credentials,
        cognitoConfig.region
      );
      
      console.log('[QA WebSocket] Connecting with SigV4 authentication...');
      
      return new Promise((resolve, reject) => {
        this.ws = new WebSocket(signedUrl);

      this.ws.onopen = () => {
        console.log('[QA WebSocket] Connected');
        this._isConnected = true;
        this.reconnectAttempts = 0;
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as QAWebSocketEvent;
          this.eventHandler(data);
        } catch (e) {
          console.error('[QA WebSocket] Failed to parse message:', e);
        }
      };

      this.ws.onclose = (event) => {
        console.log(`[QA WebSocket] Closed: code=${event.code}, reason=${event.reason}`);
        this._isConnected = false;
        this.eventHandler({ type: 'session_ended', reason: 'connection_closed' });
      };

      this.ws.onerror = (error) => {
        console.error('[QA WebSocket] Error:', error);
        this._isConnected = false;
        reject(error);
      };
      });
    } catch (error) {
      console.error('[QA WebSocket] Failed to establish connection:', error);
      throw error;
    }
  }

  startSession(): void {
    this.send({ action: 'start' });
  }

  sendAudio(base64Audio: string): void {
    this.send({ action: 'audio', data: base64Audio });
  }

  sendText(text: string): void {
    this.send({ action: 'text', text });
  }

  endSession(): void {
    this.send({ action: 'end' });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
      this._isConnected = false;
    }
  }

  private send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('[QA WebSocket] Cannot send — not connected');
    }
  }
}
