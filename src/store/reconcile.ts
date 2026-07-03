import type { PrinterStatus } from '../api/types';

const ETA_TOLERANCE_MS = 2000;

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) {
    return Math.abs(a.getTime() - b.getTime()) < ETA_TOLERANCE_MS;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as any)[k], (b as any)[k]));
}

/**
 * Structural sharing over parsePrinterStatus output: the parser rebuilds
 * every sub-object each poll tick, so reference identity is useless as a
 * change signal. Reconciliation restores it — unchanged top-level slices
 * keep the previous reference, and a fully-unchanged payload returns
 * `prev` itself so the store skips setState entirely.
 */
export function reconcileStatus(prev: PrinterStatus | null, next: PrinterStatus): PrinterStatus {
  if (!prev) return next;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<keyof PrinterStatus>;
  let changed = false;
  const out = { ...next };
  for (const key of keys) {
    if (deepEqual(prev[key], next[key])) {
      (out as any)[key] = prev[key];
    } else {
      changed = true;
    }
  }
  return changed ? out : prev;
}
