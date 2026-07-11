/**
 * Moonraker API type definitions.
 * Covers all Moonraker REST/WebSocket response shapes.
 */

// ─── Connection ────────────────────────────────────────────

export type ConnectionMode = 'local' | 'remote';

export interface MoonrakerConfig {
  /** Base URL of Moonraker API, e.g. "http://192.168.1.2:7200" (ProControl proxy) */
  baseUrl: string;
  /** local = short polling, fast timeouts. remote = longer intervals, VPN-aware. */
  mode: ConnectionMode;
  /** Override polling interval in ms. Default: local=1000, remote=3000. */
  pollInterval?: number;
  /** HTTP request timeout in ms. Default: local=5000, remote=10000. */
  timeout?: number;
  /** Maximum retry attempts for failed requests. Default: 3. */
  maxRetries?: number;
  /**
   * Returns the current bearer token for the ProControl proxy, or null when
   * unauthenticated. Called per request so a refreshed token is picked up
   * without recreating the client. When omitted, no Authorization header is
   * sent (e.g. talking to a bare Moonraker on a trusted LAN).
   */
  getAuthToken?: () => string | null | undefined;
  /**
   * Invoked when a printer request is rejected with HTTP 401 (token likely
   * expired). The host app can use this to trigger a token refresh; the next
   * poll/request then picks up the fresh token via {@link getAuthToken}.
   */
  onAuthError?: () => void;
}

// ─── Klipper Printer State ─────────────────────────────────

export type KlipperState = 'ready' | 'startup' | 'shutdown' | 'error';

export type PrintState =
  | 'standby'
  | 'printing'
  | 'paused'
  | 'complete'
  | 'cancelled'
  | 'error';

// ─── Temperature ───────────────────────────────────────────

export interface HeaterState {
  temperature: number;
  target: number;
  power: number;
}

export interface HeaterLimits {
  minTemp: number;
  maxTemp: number;
}

export interface TemperatureData {
  extruder: HeaterState | null;
  extruder1: HeaterState | null;
  heaterBed: HeaterState | null;
  /** Optional heated chamber */
  heaterChamber: HeaterState | null;
  /** Optional drying chamber 1 (generic_heater drying_chamber_1) */
  dryingChamber1: HeaterState | null;
  /** Optional drying chamber 2 (generic_heater drying_chamber_2) */
  dryingChamber2: HeaterState | null;
  /** Optional drying chamber 3 (generic_heater drying_chamber_3) */
  dryingChamber3: HeaterState | null;
  /** Optional drying chamber 4 (generic_heater drying_chamber_4) */
  dryingChamber4: HeaterState | null;
  /** Camera/enclosure temperature sensor */
  bedGlass: HeaterState | null;
}

// ─── Toolhead / Motion ─────────────────────────────────────

export interface Position {
  x: number;
  y: number;
  z: number;
  e: number;
}

export interface ToolheadState {
  position: Position;
  homed: boolean[];
  maxVelocity: number;
  maxAccel: number;
  printTime: number;
  estimatedPrintTime: number;
  activeExtruder: string;
  /** Per-axis minimum positions reported by Klipper (x, y, z). null if unknown. */
  axisMinimum: { x: number; y: number; z: number } | null;
  /** Per-axis maximum positions reported by Klipper (x, y, z). null if unknown. */
  axisMaximum: { x: number; y: number; z: number } | null;
}

// ─── Print Stats ───────────────────────────────────────────

export interface PrintStats {
  state: PrintState;
  filename: string;
  totalDuration: number;
  printDuration: number;
  filamentUsed: number;
  message: string;
  info: {
    totalLayer: number | null;
    currentLayer: number | null;
  };
}

// ─── Virtual SD Card ───────────────────────────────────────

export interface VirtualSdCard {
  filePath: string;
  progress: number;
  isActive: boolean;
  filePosition: number;
  fileSize: number;
}

// ─── Display Status (slicer-emitted M73 progress + message) ───
export interface DisplayStatus {
  /** 0..1, slicer-emitted progress via M73 — more accurate than vsd. */
  progress: number;
  /** Slicer "message" (M117) shown on physical screen. */
  message: string;
}

// ─── G-code Move (speed factor, position) ─────────────────────
export interface GcodeMove {
  /** User's M220 / set_velocity_limit scale, 1.0 = 100%. */
  speedFactor: number;
  /** M221 extrusion scale. */
  extrudeFactor: number;
  /** Current commanded speed in mm/s. */
  speed: number;
}

// ─── Fan ───────────────────────────────────────────────────

export interface FanState {
  /** Current fan speed, 0.0–1.0 (Klipper reports as fraction). */
  speed: number;
  /** Tachometer reading in RPM, null if tach not configured. */
  rpm: number | null;
}

// ─── Filament Sensors ──────────────────────────────────────

export interface FilamentSensorState {
  name: string;
  enabled: boolean;
  filamentDetected: boolean;
}

// ─── Bed Mesh ──────────────────────────────────────────────

export interface BedMeshData {
  profileName: string;
  meshMin: [number, number];
  meshMax: [number, number];
  probedMatrix: number[][];
  meshMatrix: number[][];
  profiles: Record<string, any>;
}

// ─── Combined Printer Status ───────────────────────────────

export interface PrinterStatus {
  klipperState: KlipperState;
  printStats: PrintStats;
  temperatures: TemperatureData;
  toolhead: ToolheadState;
  virtualSdCard: VirtualSdCard;
  displayStatus: DisplayStatus;
  gcodeMove: GcodeMove;
  fan: FanState | null;
  filamentSensors: FilamentSensorState[];
  /** Klipper [save_variables] persisted variables (loaded_N, preloaded_N, need_to_*, *_remaining, …) */
  saveVariables: Record<string, number | string | boolean>;
  bedMesh: BedMeshData | null;
  /** Computed fields */
  progress: number;
  eta: Date | null;
  elapsedSeconds: number;
  isConnected: boolean;
}

// ─── Files ─────────────────────────────────────────────────

export interface GcodeFile {
  filename: string;
  path: string;
  size: number;
  modified: number;
}

export interface GcodeFileMetadata extends GcodeFile {
  estimatedTime: number | null;
  filamentTotal: number | null;
  filamentWeight: number | null;
  layerHeight: number | null;
  firstLayerHeight: number | null;
  objectHeight: number | null;
  thumbnails: Thumbnail[];
  slicer: string | null;
  slicerVersion: string | null;
}

export interface Thumbnail {
  width: number;
  height: number;
  size: number;
  relativePath: string;
}

// ─── Print History ─────────────────────────────────────────

export interface PrintHistoryJob {
  jobId: string;
  filename: string;
  status: string;
  startTime: number;
  endTime: number | null;
  totalDuration: number;
  printDuration: number;
  filamentUsed: number;
  metadata: Partial<GcodeFileMetadata> | null;
  thumbnailRelativePath: string | null;
}

// ─── G-code Macros ─────────────────────────────────────────

export interface GcodeMacro {
  name: string;
  description?: string;
}

// ─── Server Info ───────────────────────────────────────────

export interface MoonrakerServerInfo {
  klippyConnected: boolean;
  klippyState: KlipperState;
  moonrakerVersion: string;
  apiVersion: number[];
  apiVersionString: string;
}

// ─── API Result wrapper ────────────────────────────────────

export interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── WebSocket Events ──────────────────────────────────────

export type MoonrakerEventType =
  | 'notify_status_update'
  | 'notify_gcode_response'
  | 'notify_klippy_ready'
  | 'notify_klippy_shutdown'
  | 'notify_klippy_disconnected'
  | 'notify_filelist_changed'
  | 'notify_history_changed'
  | 'notify_update_response'
  | 'notify_proc_stat_update';

export interface MoonrakerEvent<T = unknown> {
  method: MoonrakerEventType;
  params: T[];
}
