import { describe, expect, test, vi, afterEach } from 'vitest';
import { MoonrakerClient } from './moonraker-client';

afterEach(() => vi.unstubAllGlobals());

function clientWith(timeoutMs: number) {
  return new MoonrakerClient({ baseUrl: 'http://x', mode: 'local', timeout: timeoutMs, maxRetries: 2 });
}

describe('request retry timeout', () => {
  test('retry succeeds after first attempt times out', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      call++;
      if (call === 1) {
        // Первая попытка висит до аборта — как зависший Moonraker.
        return new Promise((_res, rej) => {
          init.signal!.addEventListener('abort', () =>
            rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      }
      return Promise.resolve(new Response(JSON.stringify({ result: { ok: true } }), { status: 200 }));
    }));

    const res = await clientWith(50).getServerInfo();
    // Сегодня: FAIL — контроллер один на все попытки; после аборта попытки 2-3
    // мгновенно падают AbortError и результат { success: false }.
    expect(res.success).toBe(true);
    expect(call).toBe(2);
  });

  test('slow-network retries still enforce a deadline', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) =>
      new Promise((_res, rej) => {
        init.signal!.addEventListener('abort', () =>
          rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })));

    const started = Date.now();
    const res = await clientWith(50).getServerInfo();
    expect(res.success).toBe(false);
    // 3 попытки × 50мс + бэкоффы (500+1000) < 2.5с; без пофиксенного дедлайна зависло бы навсегда.
    expect(Date.now() - started).toBeLessThan(2500);
  });
});
