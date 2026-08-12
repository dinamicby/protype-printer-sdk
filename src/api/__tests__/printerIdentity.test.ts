/**
 * Чем принтер представляется. Существующие `getPrinterInfo` и `getSystemInfo`
 * обе нужные строки выбрасывают при разборе ответа, поэтому здесь свой метод.
 *
 * Ответы взяты с живого QIDI X-Max 4 (192.168.0.218:7125).
 */
import { describe, expect, test, vi, afterEach } from 'vitest';
import { MoonrakerClient } from '../moonraker-client';

afterEach(() => vi.unstubAllGlobals());

function client() {
  return new MoonrakerClient({ baseUrl: 'http://x', mode: 'local', timeout: 500, maxRetries: 1 });
}

/** Отвечает на оба эндпоинта; `null` вместо тела означает HTTP 500. */
function stub(info: unknown | null, system: unknown | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const body = url.includes('/machine/system_info') ? system : info;
      if (body === null) return Promise.resolve(new Response('boom', { status: 500 }));
      return Promise.resolve(new Response(JSON.stringify({ result: body }), { status: 200 }));
    }),
  );
}

const QIDI_INFO = { state: 'ready', state_message: 'Printer is ready', hostname: 'qidi-max4' };
const QIDI_SYSTEM = { system_info: { machine_name: 'QIDI', distribution: { name: 'Debian' } } };

describe('getPrinterIdentity', () => {
  test('читает hostname и machine_name живого принтера', async () => {
    stub(QIDI_INFO, QIDI_SYSTEM);
    expect(await client().getPrinterIdentity()).toEqual({
      hostname: 'qidi-max4',
      machineName: 'QIDI',
    });
  });

  test('переживает принтер без machine_name', async () => {
    stub(QIDI_INFO, { system_info: {} });
    expect(await client().getPrinterIdentity()).toEqual({
      hostname: 'qidi-max4',
      machineName: null,
    });
  });

  test('одна упавшая половина не топит вторую', async () => {
    stub(QIDI_INFO, null);
    expect(await client().getPrinterIdentity()).toEqual({
      hostname: 'qidi-max4',
      machineName: null,
    });
  });

  test('нечего сказать — null, а не пустая личность', async () => {
    stub(null, null);
    expect(await client().getPrinterIdentity()).toBeNull();
  });

  test('никогда не бросает', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('сеть отвалилась'))));
    await expect(client().getPrinterIdentity()).resolves.toBeNull();
  });
});
