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
  | 'qa_analytics'
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

  private _closing = false;

  constructor(config: QAWebSocketConfig, onEvent: QAWebSocketEventHandler) {
    this.config = config;
    this.eventHandler = onEvent;
  }

  get isConnected(): boolean {
    return this._isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    try {
      const credentials = await getAwsCredentials(this.config.getIdToken);
      
      // Sign only the bare WS URL — AgentCore strips custom query params before
      // they reach the container. We deliver them via a setup message instead.
      const signedUrl = await signWebSocketUrl(
        WEBSOCKET_URL,
        credentials,
        cognitoConfig.region
      );
      
      console.log('[QA WebSocket] Connecting with SigV4 authentication...');
      
      return new Promise((resolve, reject) => {
        this.ws = new WebSocket(signedUrl);

      this.ws.onopen = () => {
        console.log('[QA WebSocket] Connected — sending setup');
        this._isConnected = true;
        this.reconnectAttempts = 0;
        // Send session parameters as first message
        this.send({
          action: 'setup',
          personaId: this.config.personaId,
          userId: this.config.userId,
          sessionId: this.config.sessionId,
          dateStr: this.config.dateStr,
          voiceId: this.config.voiceId ?? 'matthew',
        });
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
        if (!this._closing) {
          this.eventHandler({ type: 'session_ended', reason: 'connection_closed' });
        }
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

  requestAnalytics(): void {
    this.send({ action: 'get_analytics' });
  }

  endSession(): void {
    this.send({ action: 'end' });
  }

  disconnect(): void {
    if (this.ws) {
      this._closing = true;
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
