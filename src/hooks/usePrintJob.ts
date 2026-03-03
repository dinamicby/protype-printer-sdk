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
import { useMoonraker } from './MoonrakerProvider';
import type { PrintState } from '../api/types';

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
  /** Pause current print */
  pause: () => Promise<void>;
  /** Resume paused print */
  resume: () => Promise<void>;
  /** Cancel current print */
  cancel: () => Promise<void>;
}

export function usePrintJob(): PrintJobValue {
  const { status, client } = useMoonraker();

  const state: PrintState = status?.printStats?.state ?? 'standby';
  const progress = status?.progress ?? 0;
  const eta = status?.eta ?? null;
  const elapsedSeconds = status?.elapsedSeconds ?? 0;

  const printStats = status?.printStats;
  const vsd = status?.virtualSdCard;

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
    await client.pausePrint();
  }, [client]);

  const resume = useCallback(async () => {
    await client.resumePrint();
  }, [client]);

  const cancel = useCallback(async () => {
    await client.cancelPrint();
  }, [client]);

  return {
    ...value,
    startPrint,
    pause,
    resume,
    cancel,
  };
}
