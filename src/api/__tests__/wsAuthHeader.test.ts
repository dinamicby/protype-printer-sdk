import { afterEach, describe, expect, test, vi } from 'vitest';
import { MoonrakerWebSocket } from '../moonraker-ws';

/**
 * Перехватываем конструктор WebSocket, чтобы прочитать заголовки апгрейда.
 * Возвращаем и сам инстанс: отсутствие вызова конструктора — это тоже
 * результат, и его надо уметь отличить от «вызвали без заголовков».
 */
function captureConnect(config: Record<string, unknown>): {
  constructed: boolean;
  headers: Record<string, string> | undefined;
} {
  let constructed = false;
  let headers: Record<string, string> | undefined;

  class FakeWebSocket {
    static OPEN = 1;
    readyState = 3;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((e: unknown) => void) | null = null;
    constructor(
      _url: string,
      _protocols?: unknown,
      options?: { headers?: Record<string, string> },
    ) {
      constructed = true;
      headers = options?.headers;
    }
    close() {}
    send() {}
  }

  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  new MoonrakerWebSocket({
    url: 'ws://printer.test/websocket',
    autoReconnect: false,
    ...config,
  } as never).connect();

  return { constructed, headers };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WebSocket auth headers', () => {
  test('без токена и ключа заголовки не передаются', () => {
    expect(captureConnect({ getAuthToken: () => null }).headers).toBeUndefined();
  });

  test('ключ уходит как X-Api-Key', () => {
    expect(captureConnect({ getAuthToken: () => null, getApiKey: () => 'key-xyz' }).headers).toEqual({
      'X-Api-Key': 'key-xyz',
    });
  });

  test('bearer и ключ уживаются', () => {
    expect(
      captureConnect({ getAuthToken: () => 'jwt', getApiKey: () => 'key-xyz' }).headers,
    ).toEqual({ Authorization: 'Bearer jwt', 'X-Api-Key': 'key-xyz' });
  });

  test('конфиг без getAuthToken всё равно подключается', () => {
    // connect() зовёт getAuthToken() без ?., опираясь на дефолт из
    // конструктора. Пин на случай, если дефолт когда-нибудь уберут: TypeError
    // здесь поймает общий catch вокруг конструктора, отрапортует «ctor threw»
    // и сокет молча не поднимется никогда.
    expect(captureConnect({}).constructed).toBe(true);
  });
});
