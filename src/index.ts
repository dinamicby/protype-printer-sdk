/**
 * protype-printer-sdk
 *
 * Moonraker/Klipper SDK for the Protype printer ecosystem.
 * Provides REST client, WebSocket client, React hooks, utilities.
 *
 * Usage:
 *   import { MoonrakerProvider, usePrinterState, useTemperature } from 'protype-printer-sdk';
 */

// ─── API Layer ──────────────────────────────────────
export { MoonrakerClient } from './api/moonraker-client';
export { MoonrakerWebSocket, wsUrlFromHttp } from './api/moonraker-ws';

// ─── Types ──────────────────────────────────────────
export type {
  ConnectionMode,
  MoonrakerConfig,
  PrinterStatus,
  HeaterState,
  TemperatureData,
  ToolheadState,
  Position,
  PrintStats,
  VirtualSdCard,
  PrintState,
  KlipperState,
  FilamentSensorState,
  GcodeFile,
  GcodeFileMetadata,
  PrintHistoryJob,
  GcodeMacro,
  MoonrakerServerInfo,
  ApiResult,
  MoonrakerEvent,
  MoonrakerEventType,
} from './api/types';

// ─── React Hooks ────────────────────────────────────
export { MoonrakerProvider, useMoonraker } from './hooks/MoonrakerProvider';
export { usePrinterState } from './hooks/usePrinterState';
export { useTemperature } from './hooks/useTemperature';
export { usePrintJob } from './hooks/usePrintJob';
export { useGcode } from './hooks/useGcode';
export { useMotion } from './hooks/useMotion';
export { useFiles } from './hooks/useFiles';
export { useFilament } from './hooks/useFilament';
export { useMacros } from './hooks/useMacros';
export { usePrintHistory } from './hooks/usePrintHistory';

// Hook types
export type { PrinterStateValue } from './hooks/usePrinterState';
export type { TemperatureValue, HeaterInfo } from './hooks/useTemperature';
export type { PrintJobValue } from './hooks/usePrintJob';
export type { GcodeValue, GcodeHistoryEntry } from './hooks/useGcode';
export type { MotionValue, JogParams } from './hooks/useMotion';
export type { FilesValue } from './hooks/useFiles';
export type { FilamentValue } from './hooks/useFilament';
export type { MacrosValue } from './hooks/useMacros';
export type { PrintHistoryValue, PrintHistoryStats } from './hooks/usePrintHistory';

// ─── Utilities ──────────────────────────────────────
export {
  formatTemp,
  formatTempPair,
  formatDuration,
  formatETA,
  formatProgress,
  formatFileSize,
  formatFilamentLength,
  formatTimestamp,
  formatPower,
} from './utils/format';

export * as gcode from './utils/gcode-builder';

export {
  ENDPOINTS,
  POLL_INTERVALS,
  TIMEOUTS,
  WS_PORT,
  HTTP_PORT,
  STATUS_OBJECTS,
} from './utils/constants';

// ─── Routes ────────────────────────────────────────
export {
  HUB_ROUTES,
  KIOSK_ROUTES,
  buildPrinterUrl,
  extractPrinterId,
  isPrinterRoute,
  getActiveTab,
} from './routes';

export type { PrinterTab } from './routes';
