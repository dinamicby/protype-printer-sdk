import { describe, expect, test, vi } from 'vitest';
import { createPoller } from './poller';

describe('createPoller', () => {
  test('does not overlap slow async ticks', async () => {
    vi.useFakeTimers();
    let inFlight = 0, maxInFlight = 0, calls = 0;
    const slow = async () => {
      calls++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5000)); // дольше интервала
      inFlight--;
    };
    const p = createPoller(slow, 1000);
    p.start();
    await vi.advanceTimersByTimeAsync(10_000);
    p.stop();
    expect(maxInFlight).toBe(1);      // наложений не было
    expect(calls).toBeGreaterThan(1); // но поллинг продолжался
    vi.useRealTimers();
  });

  test('setInterval changes cadence', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const p = createPoller(async () => { calls++; }, 1000);
    p.start();
    await vi.advanceTimersByTimeAsync(3000);
    const before = calls;              // ~3-4 (start тикает сразу)
    p.setInterval(10_000);
    await vi.advanceTimersByTimeAsync(9000);
    expect(calls - before).toBeLessThanOrEqual(1);
    p.stop();
    vi.useRealTimers();
  });

  test('rejecting fn does not escape and does not wedge the poller', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const p = createPoller(async () => { calls++; throw new Error('boom'); }, 1000);
    p.start();
    await vi.advanceTimersByTimeAsync(3500);
    p.stop();
    expect(calls).toBeGreaterThan(1); // running was reset each time, ticks kept firing
    vi.useRealTimers();
  });
});
