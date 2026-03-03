/**
 * SDK constants — Moonraker endpoints, defaults, timing.
 */

/** Standard Moonraker API endpoints */
export const ENDPOINTS = {
  SERVER_INFO: '/server/info',
  PRINTER_INFO: '/printer/info',
  OBJECTS_QUERY: '/printer/objects/query',
  OBJECTS_LIST: '/printer/objects/list',
  GCODE_SCRIPT: '/printer/gcode/script',
  PRINT_START: '/printer/print/start',
  PRINT_PAUSE: '/printer/print/pause',
  PRINT_RESUME: '/printer/print/resume',
  PRINT_CANCEL: '/printer/print/cancel',
  EMERGENCY_STOP: '/printer/emergency_stop',
  FIRMWARE_RESTART: '/printer/firmware_restart',
  FILES_LIST: '/server/files/list',
  FILES_METADATA: '/server/files/metadata',
  FILES_UPLOAD: '/server/files/upload',
  HISTORY_LIST: '/server/history/list',
} as const;

/** Default polling intervals */
export const POLL_INTERVALS = {
  /** Local connection (printer ↔ ProControl on same machine) */
  local: 1000,
  /** Remote connection (ProtypeHub ↔ printer via VPN) */
  remote: 3000,
} as const;

/** Default HTTP timeouts */
export const TIMEOUTS = {
  local: 5000,
  remote: 10000,
} as const;

/** Moonraker WebSocket default port */
export const WS_PORT = 7125;

/** Default Moonraker HTTP port */
export const HTTP_PORT = 7125;

/** Objects commonly queried for full printer status */
export const STATUS_OBJECTS = [
  'print_stats',
  'virtual_sdcard',
  'toolhead',
  'extruder',
  'extruder1',
  'heater_bed',
  'heater_generic heater_chamber',
] as const;
