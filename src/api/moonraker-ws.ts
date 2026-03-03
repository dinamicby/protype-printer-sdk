/**
 * MoonrakerWebSocket — real-time JSON-RPC 2.0 WebSocket client for Moonraker.
 *
 * Moonraker uses a JSON-RPC over WebSocket protocol:
 * - Client subscribes to printer objects → receives status updates
 * - Client can call any Moonraker API method via JSON-RPC
 * - Server pushes events: gcode responses, klippy state changes, etc.
 */
import type { MoonrakerEventType } from './types';

// ─── Types ─────────────────────────────────────────────────

type EventCallback = (data: any) => void;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, any>;
  id: number;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: any;
  error?: { code: number; message: string };
  method?: string;
  params?: any[];
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface MoonrakerWsConfig {
  /** WebSocket URL, e.g. "ws://192.168.1.2:7125/websocket" */
  url: string;
  /** Auto-reconnect on disconnect. Default: true */
  autoReconnect?: boolean;
  /** Reconnect delay in ms. Default: 2000 */
  reconnectDelay?: number;
  /** Max reconnect attempts. Default: Infinity */
  maxReconnects?: number;
  /** RPC call timeout in ms. Default: 10000 */
  rpcTimeout?: number;
}

// ─── Client ────────────────────────────────────────────────

export class MoonrakerWebSocket {
  private ws: WebSocket | null = null;
  private config: Required<MoonrakerWsConfig>;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private listeners = new Map<string, Set<EventCallback>>();
  private reconnectCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _isConnected = false;
  private subscribedObjects: Record<string, string[] | null> = {};

  constructor(config: MoonrakerWsConfig) {
    this.config = {
      autoReconnect: true,
      reconnectDelay: 2000,
      maxReconnects: Infinity,
      rpcTimeout: 10000,
      ...config,
    };
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  // ─── Connection Lifecycle ──────────────────────────────

  connect(): void {
    if (this.ws) this.disconnect();

    try {
      this.ws = new WebSocket(this.config.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this._isConnected = true;
      this.reconnectCount = 0;
      this.emit('connection', { connected: true });

      // Re-subscribe if we had previous subscriptions
      if (Object.keys(this.subscribedObjects).length > 0) {
        this.subscribeObjects(this.subscribedObjects);
      }
    };

    this.ws.onclose = () => {
      this._isConnected = false;
      this.rejectAllPending('WebSocket closed');
      this.emit('connection', { connected: false });
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: JsonRpcResponse = JSON.parse(event.data as string);
        this.handleMessage(msg);
      } catch {
        // ignore malformed messages
      }
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    this._isConnected = false;
    this.rejectAllPending('Disconnected');
  }

  private scheduleReconnect(): void {
    if (!this.config.autoReconnect) return;
    if (this.reconnectCount >= this.config.maxReconnects) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectCount++;
      this.connect();
    }, this.config.reconnectDelay * Math.min(this.reconnectCount + 1, 5));
  }

  // ─── JSON-RPC Calls ────────────────────────────────────

  /** Call any Moonraker JSON-RPC method */
  call<T = any>(method: string, params?: Record<string, any>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('WebSocket not connected'));
      }

      const id = ++this.requestId;
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method,
        id,
        ...(params ? { params } : {}),
      };

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, this.config.rpcTimeout);

      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(request));
    });
  }

  // ─── Object Subscriptions ──────────────────────────────

  /**
   * Subscribe to Moonraker printer object updates.
   *
   * @param objects - Map of object names to field arrays.
   *   Use null to subscribe to all fields.
   *   Example: { "extruder": null, "heater_bed": ["temperature", "target"] }
   */
  async subscribeObjects(
    objects: Record<string, string[] | null>,
  ): Promise<any> {
    this.subscribedObjects = { ...this.subscribedObjects, ...objects };
    return this.call('printer.objects.subscribe', { objects });
  }

  /**
   * Query printer objects without subscribing.
   */
  async queryObjects(
    objects: Record<string, string[] | null>,
  ): Promise<any> {
    return this.call('printer.objects.query', { objects });
  }

  // ─── Events ────────────────────────────────────────────

  on(event: MoonrakerEventType | 'connection' | 'status_update' | 'gcode_response', callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string, data: any): void {
    this.listeners.get(event)?.forEach((cb) => {
      try { cb(data); } catch { /* ignore listener errors */ }
    });
  }

  // ─── Message Handling ──────────────────────────────────

  private handleMessage(msg: JsonRpcResponse): void {
    // RPC response (has id)
    if (msg.id !== undefined) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // Server-pushed event (has method)
    if (msg.method) {
      const eventName = msg.method as MoonrakerEventType;
      const params = msg.params;

      this.emit(eventName, params);

      // Special handling for status updates — emit parsed data
      if (eventName === 'notify_status_update' && Array.isArray(params)) {
        this.emit('status_update', params[0]);
      }
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}

/** Helper to derive WebSocket URL from HTTP base URL */
export function wsUrlFromHttp(httpUrl: string): string {
  const url = new URL(httpUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/websocket';
  return url.toString();
}
