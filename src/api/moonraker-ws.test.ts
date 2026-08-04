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

test('a locally-raised command failure reaches gcode_error subscribers', () => {
  // Klippy-shutdown / printer-not-ready rejections come back as an HTTP error
  // from the send call and are NEVER broadcast as notify_gcode_response, so
  // subscribers to that stream see nothing. This is the channel that carries
  // them, keeping one place for the UI to listen for "the command failed".
  const ws = new MoonrakerWebSocket({ url: 'ws://x/websocket', autoReconnect: false });
  const handler = vi.fn();
  ws.on('gcode_error', handler);

  ws.notifyLocalGcodeError('Klippy has shutdown');

  expect(handler).toHaveBeenCalledWith('Klippy has shutdown');
});

test('gcode_error subscribers are not woken by ordinary broadcasts', () => {
  const ws = new MoonrakerWebSocket({ url: 'ws://x/websocket', autoReconnect: false });
  const handler = vi.fn();
  ws.on('gcode_error', handler);
  (ws as any).handleMessage({
    jsonrpc: '2.0',
    method: 'notify_gcode_response',
    params: ['!! Must home axis first'],
  });
  expect(handler).not.toHaveBeenCalled();
});
