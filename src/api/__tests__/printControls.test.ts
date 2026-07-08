import { describe, expect, test, vi, afterEach } from 'vitest';
import { MoonrakerClient } from '../moonraker-client';

afterEach(() => vi.unstubAllGlobals());

function client() {
  return new MoonrakerClient({ baseUrl: 'http://x', mode: 'local', timeout: 500, maxRetries: 0 });
}

// M25: pause/resume/cancel are the operator's abort path during a print.
// The client resolves-never-rejects, so a failed abort is only visible via
// `ApiResult.success` — usePrintJob must forward this instead of discarding
// it. These tests pin the client-level contract that fix relies on.
describe('print control commands surface failure via ApiResult', () => {
  test('pausePrint resolves success:false on a Moonraker error response', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { message: 'Not printing' } }), { status: 400 }))));

    const res = await client().pausePrint();
    expect(res.success).toBe(false);
    expect(res.error).toBeTruthy();
  });

  test('cancelPrint resolves success:false when the request fails outright', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));

    const res = await client().cancelPrint();
    expect(res.success).toBe(false);
    expect(res.error).toBeTruthy();
  });

  test('resumePrint resolves success:true on a normal Moonraker response', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ result: 'ok' }), { status: 200 }))));

    const res = await client().resumePrint();
    expect(res.success).toBe(true);
  });
});
