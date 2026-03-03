/**
 * usePrinterState — derived printer state from MoonrakerProvider.
 *
 * Provides high-level printer status, Klipper state, and convenience
 * boolean flags for UI rendering.
 *
 * Usage:
 *   const { state, klipperState, isPrinting, isPaused, isIdle } = usePrinterState();
 */
import { useMemo } from 'react';
import { useMoonraker } from './MoonrakerProvider';
import type { PrintState, KlipperState, PrinterStatus } from '../api/types';

export interface PrinterStateValue {
  /** Full printer status object */
  status: PrinterStatus | null;
  /** Current print state: standby, printing, paused, etc. */
  printState: PrintState;
  /** Klipper firmware state: ready, startup, shutdown, error */
  klipperState: KlipperState;
  /** Whether connected to Moonraker */
  isConnected: boolean;
  /** Whether WebSocket is connected */
  wsConnected: boolean;
  /** Connection error message */
  error: string | null;

  // ─── Convenience Flags ─────────────────────────────
  /** Printer is idle / standby */
  isIdle: boolean;
  /** Actively printing */
  isPrinting: boolean;
  /** Print is paused */
  isPaused: boolean;
  /** Print completed */
  isComplete: boolean;
  /** Print was cancelled */
  isCancelled: boolean;
  /** Printer is in error state */
  isError: boolean;
  /** Klipper is ready */
  isReady: boolean;
  /** Klipper is starting up */
  isStarting: boolean;
  /** Klipper is shut down */
  isShutdown: boolean;
}

export function usePrinterState(): PrinterStateValue {
  const { status, isConnected, wsConnected, error } = useMoonraker();

  return useMemo(() => {
    const printState: PrintState = status?.printStats?.state ?? 'standby';
    const klipperState: KlipperState = status?.klipperState ?? 'startup';

    return {
      status,
      printState,
      klipperState,
      isConnected,
      wsConnected,
      error,

      isIdle: printState === 'standby',
      isPrinting: printState === 'printing',
      isPaused: printState === 'paused',
      isComplete: printState === 'complete',
      isCancelled: printState === 'cancelled',
      isError: printState === 'error',
      isReady: klipperState === 'ready',
      isStarting: klipperState === 'startup',
      isShutdown: klipperState === 'shutdown',
    };
  }, [status, isConnected, wsConnected, error]);
}
