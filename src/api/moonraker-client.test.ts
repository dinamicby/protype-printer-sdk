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

describe('motion mode prefixes', () => {
  // Захватываем именно ту G-code строку, что уходит в /printer/gcode/script.
  function clientRecordingScripts() {
    const scripts: string[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      if (init?.body) {
        try { scripts.push(JSON.parse(init.body as string).script); } catch { /* не gcode-POST */ }
      }
      return Promise.resolve(new Response(JSON.stringify({ result: 'ok' }), { status: 200 }));
    }));
    const client = new MoonrakerClient({ baseUrl: 'http://x', mode: 'local', timeout: 1000, maxRetries: 0 });
    return { client, scripts };
  }

  test('moveAbsolute prefixes G90 so an absolute target is never applied as a relative delta', async () => {
    const { client, scripts } = clientRecordingScripts();

    const res = await client.moveAbsolute({ x: 10, y: 20, speed: 3000 });

    expect(res.success).toBe(true);
    // Если станок остался в G91 (relative) после прерванного макроса, без явного G90
    // «абсолютный» ход применится как дельта и обойдёт клампы position_max.
    expect(scripts).toEqual(['G90\nG1 X10 Y20 F3000']);
  });

  test('moveRelative brackets its move in G91/G90 (регресс-замок для симметрии)', async () => {
    const { client, scripts } = clientRecordingScripts();

    await client.moveRelative({ z: 5, speed: 600 });

    expect(scripts).toEqual(['G91\nG1 Z5 F600\nG90']);
  });
});
