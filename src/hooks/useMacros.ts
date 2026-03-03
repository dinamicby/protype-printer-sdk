/**
 * useMacros — Klipper macro management.
 *
 * Lists available macros, runs them, and tracks execution state.
 *
 * Usage:
 *   const { macros, runMacro } = useMacros();
 *   await runMacro('CLEAN_NOZZLE');
 */
import { useState, useCallback, useEffect } from 'react';
import { useMoonraker } from './MoonrakerProvider';
import type { GcodeMacro } from '../api/types';

export interface MacrosValue {
  /** Available Klipper macros */
  macros: GcodeMacro[];
  /** Whether macros are being loaded */
  isLoading: boolean;
  /** Error loading macros */
  error: string | null;
  /** Currently running macro name (null if idle) */
  runningMacro: string | null;

  // ─── Actions ──────────────────────────────────────
  /** Refresh macro list */
  refresh: () => Promise<void>;
  /** Run a macro by name (optionally with params) */
  runMacro: (name: string, params?: Record<string, string | number>) => Promise<void>;
  /** Get macros filtered by visibility (non-hidden) */
  visibleMacros: GcodeMacro[];
}

export function useMacros(): MacrosValue {
  const { client } = useMoonraker();
  const [macros, setMacros] = useState<GcodeMacro[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runningMacro, setRunningMacro] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await client.listMacros();
      if (result.success && result.data) {
        setMacros(result.data);
      } else {
        setError(result.error ?? 'Failed to load macros');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load macros');
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  // Load macros on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  const runMacro = useCallback(
    async (name: string, params?: Record<string, string | number>) => {
      setRunningMacro(name);
      try {
        // Build command with optional parameters
        let cmd = name.toUpperCase();
        if (params) {
          const paramStr = Object.entries(params)
            .map(([k, v]) => `${k.toUpperCase()}=${v}`)
            .join(' ');
          if (paramStr) cmd += ` ${paramStr}`;
        }
        await client.runMacro(cmd);
      } finally {
        setRunningMacro(null);
      }
    },
    [client],
  );

  // Filter out hidden macros (names starting with _)
  const visibleMacros = macros.filter((m) => !m.name.startsWith('_'));

  return {
    macros,
    isLoading,
    error,
    runningMacro,
    refresh,
    runMacro,
    visibleMacros,
  };
}
