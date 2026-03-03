/**
 * Formatting utilities for printer data display.
 */

/** Format temperature with degree symbol. "215°C" or "—" if null */
export function formatTemp(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(decimals)}°C`;
}

/** Format temperature pair: "215 / 220°C" */
export function formatTempPair(
  current: number | null | undefined,
  target: number | null | undefined,
  decimals = 0,
): string {
  const c = current !== null && current !== undefined ? current.toFixed(decimals) : '—';
  const t = target !== null && target !== undefined ? target.toFixed(decimals) : '—';
  return `${c} / ${t}°C`;
}

/** Format seconds to "HH:MM:SS" or "MM:SS" */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Format ETA as "~2ч 15м" or "~15м" */
export function formatETA(etaDate: Date | null): string {
  if (!etaDate) return '—';
  const remaining = Math.max(0, (etaDate.getTime() - Date.now()) / 1000);
  if (remaining < 60) return '<1м';
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  return h > 0 ? `~${h}ч ${m}м` : `~${m}м`;
}

/** Format progress as percentage: "45.2%" */
export function formatProgress(progress: number, decimals = 1): string {
  return `${(progress * 100).toFixed(decimals)}%`;
}

/** Format file size: "1.2 MB", "340 KB" */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Format filament length: "12.5 m" or "450 mm" */
export function formatFilamentLength(mm: number | null | undefined): string {
  if (mm === null || mm === undefined) return '—';
  if (mm >= 1000) return `${(mm / 1000).toFixed(1)} м`;
  return `${mm.toFixed(0)} мм`;
}

/** Format UNIX timestamp to locale date string */
export function formatTimestamp(unix: number): string {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleString();
}

/** Heater power to percentage: 0.75 → "75%" */
export function formatPower(power: number | null | undefined): string {
  if (power === null || power === undefined) return '—';
  return `${Math.round(power * 100)}%`;
}
