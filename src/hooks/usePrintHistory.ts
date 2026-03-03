/**
 * usePrintHistory — React hook for accessing print job history from Moonraker.
 *
 * Fetches `/server/history/list` and provides sorting, filtering,
 * and summary statistics for completed print jobs.
 *
 * Usage:
 *   const { jobs, isLoading, refresh, totalPrintTime, stats } = usePrintHistory();
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useMoonraker } from './MoonrakerProvider';
import type { PrintHistoryJob } from '../api/types';

// ─── Types ─────────────────────────────────────────────────

export interface PrintHistoryStats {
  totalJobs: number;
  completed: number;
  cancelled: number;
  errors: number;
  totalPrintTimeSec: number;
  totalFilamentMm: number;
  successRate: number; // 0.0-1.0
}

export interface PrintHistoryValue {
  /** All history jobs (newest first) */
  jobs: PrintHistoryJob[];
  /** Loading state */
  isLoading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Refresh history from server */
  refresh: () => Promise<void>;
  /** Filter jobs by filename */
  searchJobs: (query: string) => PrintHistoryJob[];
  /** Only completed jobs */
  completedJobs: PrintHistoryJob[];
  /** Only failed / cancelled jobs */
  failedJobs: PrintHistoryJob[];
  /** Summary statistics */
  stats: PrintHistoryStats;
}

// ─── Hook ──────────────────────────────────────────────────

export function usePrintHistory(limit = 50): PrintHistoryValue {
  const { client } = useMoonraker();
  const [jobs, setJobs] = useState<PrintHistoryJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await client.getPrintHistory(limit);
      if (result.success && result.data) {
        setJobs(result.data);
      } else {
        setError(result.error ?? 'Failed to fetch print history');
      }
    } catch (e: any) {
      setError(e.message ?? 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [client, limit]);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  const searchJobs = useCallback(
    (query: string) => {
      const q = query.toLowerCase();
      return jobs.filter((j) => j.filename.toLowerCase().includes(q));
    },
    [jobs],
  );

  const completedJobs = useMemo(
    () => jobs.filter((j) => j.status === 'completed'),
    [jobs],
  );

  const failedJobs = useMemo(
    () => jobs.filter((j) => j.status === 'cancelled' || j.status === 'error' || j.status === 'klippy_shutdown'),
    [jobs],
  );

  const stats = useMemo<PrintHistoryStats>(() => {
    const completed = jobs.filter((j) => j.status === 'completed').length;
    const cancelled = jobs.filter((j) => j.status === 'cancelled').length;
    const errors = jobs.filter((j) => j.status === 'error' || j.status === 'klippy_shutdown').length;
    const totalPrintTimeSec = jobs.reduce((sum, j) => sum + j.printDuration, 0);
    const totalFilamentMm = jobs.reduce((sum, j) => sum + j.filamentUsed, 0);
    const totalJobs = jobs.length;
    const successRate = totalJobs > 0 ? completed / totalJobs : 0;

    return { totalJobs, completed, cancelled, errors, totalPrintTimeSec, totalFilamentMm, successRate };
  }, [jobs]);

  return {
    jobs,
    isLoading,
    error,
    refresh,
    searchJobs,
    completedJobs,
    failedJobs,
    stats,
  };
}
