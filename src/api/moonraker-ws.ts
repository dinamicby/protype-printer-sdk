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

/** Maximum reconnect backoff (ms). */
const MAX_RECONNECT_DELAY_MS = 30000;

/**
 * Exponential reconnect backoff capped at {@link MAX_RECONNECT_DELAY_MS}.
 * Pure (no jitter) so it is deterministically unit-testable; the caller adds
 * jitter. Replaces the old `delay * min(count+1, 5)` curve that capped at ~10s
 * and hammered an offline printer forever (C1).
 */
export function computeReconnectDelay(
  attempt: number,
  baseDelay: number,
): number {
  return Math.min(baseDelay * Math.pow(2, attempt), MAX_RECONNECT_DELAY_MS);
}

// ─── Diagnostics (gated) ───────────────────────────────────

/**
 * WS lifecycle tracing, OFF unless `globalThis.__WSDIAG__ === true`. Routed
 * through console.warn so the kiosk shell's console→shell.log bridge captures
 * it (WebKitGTK doesn't surface console otherwise). Temporary: used to root-
 * cause the kiosk "connected but silent WS" latency; strip once resolved.
 */
export function wsdiag(msg: string): void {
  try {
    if (typeof globalThis !== 'undefined' && (globalThis as any).__WSDIAG__ === true) {
      // eslint-disable-next-line no-console
      console.warn(`[WSDIAG] ${msg}`);
    }
  } catch { /* logging must never break the socket */ }
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
  private statusUpdateCount = 0; // WSDIAG: pushes actually received

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

    wsdiag(`connect() -> ${this.config.url}`);
    try {
      this.ws = new WebSocket(this.config.url);
    } catch (e) {
      wsdiag(`WebSocket ctor threw: ${e}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this._isConnected = true;
      this.reconnectCount = 0;
      this.statusUpdateCount = 0;
      wsdiag('OPEN');
      this.emit('connection', { connected: true });

      // Re-subscribe if we had previous subscriptions.
      // A rejection here must not escape: it becomes a global
      // unhandledrejection and the shell's bootstrap handler turns it
      // into a fatal full-screen error (see App.tsx history).
      if (Object.keys(this.subscribedObjects).length > 0) {
        this.subscribeObjects(this.subscribedObjects).catch(() => {});
      }
    };

    this.ws.onclose = (ev: CloseEvent) => {
      wsdiag(`CLOSE code=${ev?.code} reason=${ev?.reason || '-'} clean=${ev?.wasClean} statusUpdates=${this.statusUpdateCount}`);
      this._isConnected = false;
      this.rejectAllPending('WebSocket closed');
      this.emit('connection', { connected: false });
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      wsdiag('ERROR (onclose follows)');
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
    // Don't stack timers: if a reconnect is already pending, leave it.
    if (this.reconnectTimer) return;

    // Exponential backoff capped at 30s + up to 30% jitter, so a permanently
    // offline printer (and many open printer screens at once) backs off
    // gracefully instead of reopening a socket every 10s forever.
    const base = computeReconnectDelay(
      this.reconnectCount,
      this.config.reconnectDelay,
    );
    const delay = base + base * 0.3 * Math.random();
    wsdiag(`reconnect in ${Math.round(delay)}ms (attempt ${this.reconnectCount})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectCount++;
      this.connect();
    }, delay);
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
        this.statusUpdateCount++;
        if (this.statusUpdateCount === 1 || this.statusUpdateCount % 25 === 0) {
          wsdiag(`status_update #${this.statusUpdateCount}`);
        }
        this.emit('status_update', params[0]);
      }
      // Moonraker sends console output as notify_gcode_response with params
      // [text]. Consumers (useGcode's console, PID capture) subscribe to the
      // friendly 'gcode_response' event with the string payload — alias it
      // here, mirroring status_update. Without this the live G-code response
      // stream is dead app-wide (empty console, PID auto-capture never fires).
      if (eventName === 'notify_gcode_response' && Array.isArray(params)) {
        this.emit('gcode_response', params[0]);
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
  const wsProto = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProto}//${url.host}/websocket`;
}
