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

describe('blocking gcode sends: send-once, no duplicate execution', () => {
  // A homing/calibration POST holds Moonraker's /printer/gcode/script response
  // open until the move physically finishes (seconds→minutes). The generic
  // retry loop must NOT re-POST it on a slow/failed attempt — Moonraker does
  // not cancel the in-flight move when the client disconnects, so a re-send
  // queues a SECOND homing. One tap on «Парковка» became three back-to-back
  // homings on the kiosk (mode=local, timeout=5s < homing duration).

  test('sendGcode issues exactly one request and never retries on failure', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      calls++;
      return Promise.reject(new Error('transient network glitch'));
    }));
    const client = new MoonrakerClient({ baseUrl: 'http://x', mode: 'local', timeout: 50, maxRetries: 2 });

    const res = await client.sendGcode('G28');

    expect(res.success).toBe(false);
    // Before fix: 3 (attempts 0,1,2) → two extra G28s queued on the printer.
    expect(calls).toBe(1);
  });

  test('a slow homing is not aborted at the short base timeout (so it never trips a re-send)', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      calls++;
      return new Promise((res, rej) => {
        const t = setTimeout(
          () => res(new Response(JSON.stringify({ result: 'ok' }), { status: 200 })),
          120,
        );
        init.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          rej(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    }));
    // base timeout 50ms ≪ 120ms blocking response; a gcode send must outlast it.
    const client = new MoonrakerClient({ baseUrl: 'http://x', mode: 'local', timeout: 50, maxRetries: 2 });

    const res = await client.sendGcode('G28');

    expect(res.success).toBe(true);
    expect(calls).toBe(1);
  });

  test('idempotent GET polling still retries transient failures', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      calls++;
      return Promise.reject(new Error('glitch'));
    }));
    const client = new MoonrakerClient({ baseUrl: 'http://x', mode: 'local', timeout: 20, maxRetries: 2 });

    const res = await client.getServerInfo();

    expect(res.success).toBe(false);
    // GETs are safe to re-send; only non-idempotent writes must not be.
    expect(calls).toBe(3);
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
