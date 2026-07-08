import { describe, expect, test, vi } from 'vitest';
import { MoonrakerWebSocket } from './moonraker-ws';

class FakeWebSocket {
  static OPEN = 1;
  readyState = 3; // CLOSED — call() внутри subscribeObjects мгновенно реджектит
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  close() {}
  send() {}
}

test('reconnect with stale subscriptions does not emit unhandledrejection', async () => {
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  const unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);

  const ws = new MoonrakerWebSocket({ url: 'ws://x/websocket', autoReconnect: false });
  await ws.subscribeObjects({ extruder: null }).catch(() => {}); // seed subscribedObjects
  ws.connect();
  // Симулируем открытие сокета: onopen дёргает ресабскрайб, который реджектит,
  // т.к. readyState !== OPEN.
  (ws as any).ws.onopen();
  await new Promise((r) => setTimeout(r, 20));

  process.off('unhandledRejection', unhandled);
  vi.unstubAllGlobals();
  expect(unhandled).not.toHaveBeenCalled(); // сегодня: FAIL
});

test('notify_gcode_response is aliased to gcode_response with the string payload', () => {
  const ws = new MoonrakerWebSocket({ url: 'ws://x/websocket', autoReconnect: false });
  const handler = vi.fn();
  ws.on('gcode_response', handler);
  // Moonraker frame: params is [text]. Consumers listen for 'gcode_response'.
  (ws as any).handleMessage({
    jsonrpc: '2.0',
    method: 'notify_gcode_response',
    params: ['// echo: probe ok'],
  });
  expect(handler).toHaveBeenCalledWith('// echo: probe ok');
});
