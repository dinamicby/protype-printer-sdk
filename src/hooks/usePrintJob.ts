/**
 * usePrintJob — current print job state and controls.
 *
 * Provides progress, ETA, elapsed time, filename, and print controls
 * (pause, resume, cancel, start).
 *
 * Usage:
 *   const { progress, eta, filename, pause, resume, cancel } = usePrintJob();
 */
import { useMemo, useCallback } from 'react';
import { useMoonraker, usePrinterSelector } from './MoonrakerProvider';
import type { ApiResult, PrintState } from '../api/types';

export interface PrintJobValue {
  /** Current print state */
  state: PrintState;
  /** Progress 0.0–1.0 */
  progress: number;
  /** Progress as percentage string: "45.2%" */
  progressPercent: string;
  /** ETA as Date or null */
  eta: Date | null;
  /** Elapsed seconds */
  elapsedSeconds: number;
  /** Currently printing filename */
  filename: string | null;
  /** Total print duration (including pauses) */
  totalDuration: number;
  /** Actual print duration (excluding pauses) */
  printDuration: number;
  /** Filament used in mm */
  filamentUsed: number;
  /** Status message from Klipper */
  message: string | null;
  /** Virtual SD card is active */
  isActive: boolean;

  // ─── Controls ─────────────────────────────────────
  /** Start a print by filename */
  startPrint: (filename: string) => Promise<void>;
  /**
   * Pause current print. Resolves with the underlying `ApiResult` — check
   * `.success` to detect a failed pause (the client never rejects, so this
   * is the only way to know an abort command didn't reach Klipper).
   */
  pause: () => Promise<ApiResult<void>>;
  /** Resume paused print. See `pause` for the failure-surfacing contract. */
  resume: () => Promise<ApiResult<void>>;
  /** Cancel current print. See `pause` for the failure-surfacing contract. */
  cancel: () => Promise<ApiResult<void>>;
}

export function usePrintJob(): PrintJobValue {
  // Commands need the (stable) REST client; job data comes from narrow store
  // slices whose references stay stable across unchanged ticks.
  const { client } = useMoonraker();
  const progressRaw = usePrinterSelector((s) => s.status?.progress);
  const eta = usePrinterSelector((s) => s.status?.eta ?? null);
  const elapsedSecondsRaw = usePrinterSelector((s) => s.status?.elapsedSeconds);
  const printStats = usePrinterSelector((s) => s.status?.printStats);
  const vsd = usePrinterSelector((s) => s.status?.virtualSdCard);

  const state: PrintState = printStats?.state ?? 'standby';
  const progress = progressRaw ?? 0;
  const elapsedSeconds = elapsedSecondsRaw ?? 0;

  const value = useMemo(
    () => ({
      state,
      progress,
      progressPercent: `${(progress * 100).toFixed(1)}%`,
      eta,
      elapsedSeconds,
      filename: printStats?.filename ?? null,
      totalDuration: printStats?.totalDuration ?? 0,
      printDuration: printStats?.printDuration ?? 0,
      filamentUsed: printStats?.filamentUsed ?? 0,
      message: printStats?.message ?? null,
      isActive: vsd?.isActive ?? false,
    }),
    [state, progress, eta, elapsedSeconds, printStats, vsd],
  );

  const startPrint = useCallback(
    async (filename: string) => {
      await client.startPrint(filename);
    },
    [client],
  );

  const pause = useCallback(async () => {
    return client.pausePrint();
  }, [client]);

  const resume = useCallback(async () => {
    return client.resumePrint();
  }, [client]);

  const cancel = useCallback(async () => {
    return client.cancelPrint();
  }, [client]);

  return {
    ...value,
    startPrint,
    pause,
    resume,
    cancel,
  };
}
