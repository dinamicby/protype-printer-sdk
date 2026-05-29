/**
 * MoonrakerClient — platform-agnostic REST client for Moonraker API.
 *
 * Works in both browser (React renderer) and Node.js (Electron main) contexts
 * using native fetch(). No Electron or axios dependency.
 */
import type {
  MoonrakerConfig,
  ApiResult,
  GcodeFile,
  GcodeFileMetadata,
  PrintHistoryJob,
  PrinterStatus,
  HeaterState,
  HeaterLimits,
  PrintState,
  KlipperState,
  MoonrakerServerInfo,
  GcodeMacro,
  FilamentSensorState,
  FanState,
  Thumbnail,
  TemperatureData,
} from './types';

// ─── Default Config ────────────────────────────────────────

const DEFAULTS = {
  local: { pollInterval: 1000, timeout: 5000, maxRetries: 2 },
  remote: { pollInterval: 3000, timeout: 10000, maxRetries: 3 },
} as const;

// ─── Client ────────────────────────────────────────────────

export class MoonrakerClient {
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;

  constructor(private config: MoonrakerConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    const defaults = DEFAULTS[config.mode];
    this.timeout = config.timeout ?? defaults.timeout;
    this.maxRetries = config.maxRetries ?? defaults.maxRetries;
  }

  /** Update the base URL (e.g. when switching printers) */
  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, '');
    this.config = { ...this.config, baseUrl: this.baseUrl };
  }

  get url(): string {
    return this.baseUrl;
  }

  get mode() {
    return this.config.mode;
  }

  get pollInterval(): number {
    return this.config.pollInterval ?? DEFAULTS[this.config.mode].pollInterval;
  }

  // ─── Low-level HTTP ────────────────────────────────────

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<ApiResult<T>> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let lastError: string = 'Unknown error';

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const resp = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            ...options.headers,
          },
        });

        clearTimeout(timer);

        if (!resp.ok) {
          lastError = `HTTP ${resp.status}: ${resp.statusText}`;
          // Don't retry on 4xx client errors
          if (resp.status >= 400 && resp.status < 500) {
            return { success: false, error: lastError };
          }
          continue;
        }

        const json = await resp.json();
        return { success: true, data: json.result ?? json };
      } catch (err: any) {
        clearTimeout(timer);
        lastError = err?.name === 'AbortError'
          ? `Request timed out after ${this.timeout}ms`
          : err?.message ?? 'Network error';

        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }

    return { success: false, error: lastError };
  }

  private get<T>(path: string): Promise<ApiResult<T>> {
    return this.request<T>(path);
  }

  private post<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
    return this.request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  // ─── Server Info ───────────────────────────────────────

  async getServerInfo(): Promise<ApiResult<MoonrakerServerInfo>> {
    const res = await this.get<any>('/server/info');
    if (!res.success || !res.data) return res;

    const d = res.data;
    return {
      success: true,
      data: {
        klippyConnected: d.klippy_connected ?? false,
        klippyState: (d.klippy_state as KlipperState) ?? 'error',
        moonrakerVersion: d.moonraker_version ?? '',
        apiVersion: d.api_version ?? [],
        apiVersionString: d.api_version_string ?? '',
      },
    };
  }

  // ─── Printer Status ────────────────────────────────────

  async getPrinterStatus(): Promise<ApiResult<PrinterStatus>> {
    // Build query for all relevant objects
    const fsNames = Array.from({ length: 8 }, (_, i) => `FS${i + 1}`);
    const objects = [
      'print_stats',
      'virtual_sdcard',
      // display_status carries the slicer's M73 progress + remaining-time and
      // M117 message; gcode_move carries speed/flow factors. Both are read by
      // parsePrinterStatus below and subscribed to over WebSocket — but with
      // WS disabled (REST-only polling) they MUST be queried here too, or
      // progress silently falls back to virtual_sdcard's non-linear byte
      // ratio (jumpy %/ETA) and speed/flow read a flat 100%.
      'display_status',
      'gcode_move',
      'toolhead',
      'extruder',
      'extruder1',
      'heater_bed',
      'heater_generic Active_Chamber',
      'heater_generic Drying_Chamber_1',
      'heater_generic Drying_Chamber_2',
      'heater_generic Drying_Chamber_3',
      'heater_generic Drying_Chamber_4',
      'temperature_sensor bed_glass',
      'fan',
      ...fsNames.map((n) => `filament_switch_sensor ${n}`),
      ...fsNames.map((n) => `filament_motion_sensor ${n}`),
    ];

    const query = objects.map((o) => encodeURIComponent(o)).join('&');
    const res = await this.get<any>(`/printer/objects/query?${query}`);
    if (!res.success || !res.data) return { success: false, error: res.error };

    const status = res.data.status ?? res.data;
    return { success: true, data: this.parsePrinterStatus(status) };
  }

  private parsePrinterStatus(obj: Record<string, any>): PrinterStatus {
    // Print stats
    const ps = obj.print_stats ?? {};
    const printStats = {
      state: (ps.state as PrintState) ?? 'standby',
      filename: ps.filename ?? '',
      totalDuration: Number(ps.total_duration ?? 0),
      printDuration: Number(ps.print_duration ?? 0),
      filamentUsed: Number(ps.filament_used ?? 0),
      message: ps.message ?? '',
      info: {
        totalLayer: ps.info?.total_layer ?? null,
        currentLayer: ps.info?.current_layer ?? null,
      },
    };

    // Virtual SD
    const vsd = obj.virtual_sdcard ?? {};
    const virtualSdCard = {
      filePath: vsd.file_path ?? '',
      progress: Number(vsd.progress ?? 0),
      isActive: vsd.is_active ?? false,
      filePosition: Number(vsd.file_position ?? 0),
      fileSize: Number(vsd.file_size ?? 0),
    };

    // Display status — slicer-emitted M73 progress + M117 message.
    // More accurate than vsd.progress when the slicer drives the
    // percentage (especially with non-linear remaining-time estimates).
    const ds = obj.display_status ?? {};
    const displayStatus = {
      progress: Number(ds.progress ?? 0),
      message: ds.message ?? '',
    };

    // gcode_move — speed factor / extrude factor for Mainsail-style HUD.
    const gm = obj.gcode_move ?? {};
    const gcodeMove = {
      speedFactor: Number(gm.speed_factor ?? 1),
      extrudeFactor: Number(gm.extrude_factor ?? 1),
      speed: Number(gm.speed ?? 0),
    };

    // Part cooling fan — Klipper [fan] section, speed is 0..1 fraction.
    const fanObj = obj.fan;
    const fan: FanState | null = fanObj && typeof fanObj.speed !== 'undefined'
      ? {
          speed: Number(fanObj.speed ?? 0),
          rpm: fanObj.rpm !== null && fanObj.rpm !== undefined ? Number(fanObj.rpm) : null,
        }
      : null;

    // Temperatures
    const temperatures: TemperatureData = {
      extruder: this.parseHeater(obj.extruder),
      extruder1: this.parseHeater(obj.extruder1),
      heaterBed: this.parseHeater(obj.heater_bed),
      heaterChamber: this.parseHeater(obj['heater_generic Active_Chamber']),
      dryingChamber1: this.parseHeater(obj['heater_generic Drying_Chamber_1']),
      dryingChamber2: this.parseHeater(obj['heater_generic Drying_Chamber_2']),
      dryingChamber3: this.parseHeater(obj['heater_generic Drying_Chamber_3']),
      dryingChamber4: this.parseHeater(obj['heater_generic Drying_Chamber_4']),
      bedGlass: this.parseHeater(obj['temperature_sensor bed_glass']),
    };

    // Toolhead
    const th = obj.toolhead ?? {};
    const pos = th.position ?? [0, 0, 0, 0];
    const toolhead = {
      position: { x: pos[0] ?? 0, y: pos[1] ?? 0, z: pos[2] ?? 0, e: pos[3] ?? 0 },
      homed: th.homed_axes
        ? ['x', 'y', 'z'].map((a) => (th.homed_axes ?? '').includes(a))
        : [false, false, false],
      maxVelocity: Number(th.max_velocity ?? 0),
      maxAccel: Number(th.max_accel ?? 0),
      printTime: Number(th.print_time ?? 0),
      estimatedPrintTime: Number(th.estimated_print_time ?? 0),
      activeExtruder: th.extruder ?? 'extruder',
    };

    // Filament sensors (FS1..FS8)
    const filamentSensors: FilamentSensorState[] = [];
    for (let i = 1; i <= 8; i++) {
      const sw = obj[`filament_switch_sensor FS${i}`];
      const mo = obj[`filament_motion_sensor FS${i}`];
      const sensor = sw ?? mo;
      if (sensor) {
        filamentSensors.push({
          name: `FS${i}`,
          enabled: sensor.enabled ?? true,
          filamentDetected:
            sensor.filament_detected ?? sensor.filament_present ?? false,
        });
      }
    }

    // Computed progress — prefer slicer's M73 (display_status) when present,
    // fall back to virtual_sdcard's file-position ratio otherwise. The
    // display_status path is what Mainsail / Fluidd surface and matches what
    // the slicer told the printer the remaining-time is.
    const progress = displayStatus.progress > 0
      ? displayStatus.progress
      : virtualSdCard.progress;
    const elapsed = printStats.printDuration;
    const etaSeconds = progress > 0
      ? Math.max(0, Math.round(elapsed * (1 / progress - 1)))
      : null;

    return {
      klipperState: 'ready',
      printStats,
      temperatures,
      toolhead,
      virtualSdCard,
      displayStatus,
      gcodeMove,
      fan,
      filamentSensors,
      progress,
      eta: etaSeconds !== null ? new Date(Date.now() + etaSeconds * 1000) : null,
      elapsedSeconds: elapsed,
      isConnected: true,
    };
  }

  private parseHeater(data: any): HeaterState | null {
    if (!data || typeof data.temperature === 'undefined') return null;
    return {
      temperature: Number(data.temperature ?? 0),
      target: Number(data.target ?? 0),
      power: Number(data.power ?? 0),
    };
  }

  // ─── Temperature Control ───────────────────────────────

  async setExtruderTemp(target: number, extruder = 0): Promise<ApiResult<void>> {
    const tool = extruder === 0 ? 'extruder' : `extruder${extruder}`;
    return this.sendGcode(`SET_HEATER_TEMPERATURE HEATER=${tool} TARGET=${target}`);
  }

  async setBedTemp(target: number): Promise<ApiResult<void>> {
    return this.sendGcode(`SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=${target}`);
  }

  async setChamberTemp(target: number): Promise<ApiResult<void>> {
    return this.sendGcode(`SET_HEATER_TEMPERATURE HEATER=Active_Chamber TARGET=${target}`);
  }

  // ─── Heater Limits (from configfile) ───────────────────

  /**
   * Fetch printer config and extract min/max temperature limits per heater.
   * Returns a map keyed by Klipper section name (e.g. "extruder", "heater_bed",
   * "heater_generic Active_Chamber") to its {min_temp, max_temp} bounds.
   */
  async getHeaterLimits(): Promise<ApiResult<Record<string, HeaterLimits>>> {
    const res = await this.get<any>('/printer/objects/query?configfile');
    if (!res.success || !res.data) return { success: false, error: res.error };

    const cfg =
      res.data.status?.configfile?.config ??
      res.data.configfile?.config ??
      {};

    const limits: Record<string, HeaterLimits> = {};
    for (const [section, raw] of Object.entries<any>(cfg)) {
      if (!raw || typeof raw !== 'object') continue;
      if (raw.max_temp === undefined && raw.min_temp === undefined) continue;
      const min = Number(raw.min_temp ?? 0);
      const max = Number(raw.max_temp ?? 0);
      if (!Number.isFinite(max) || max <= 0) continue;
      limits[section] = { minTemp: Number.isFinite(min) ? min : 0, maxTemp: max };
    }
    return { success: true, data: limits };
  }

  // ─── G-code ────────────────────────────────────────────

  async sendGcode(script: string): Promise<ApiResult<void>> {
    return this.post('/printer/gcode/script', { script });
  }

  // ─── Motion ────────────────────────────────────────────

  async home(axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z']): Promise<ApiResult<void>> {
    const axStr = axes.map((a) => a.toUpperCase()).join(' ');
    return this.sendGcode(`G28 ${axStr}`);
  }

  async moveRelative(params: {
    x?: number;
    y?: number;
    z?: number;
    speed?: number;
  }): Promise<ApiResult<void>> {
    const parts = ['G91']; // relative mode
    const move = ['G1'];
    if (params.x !== undefined) move.push(`X${params.x}`);
    if (params.y !== undefined) move.push(`Y${params.y}`);
    if (params.z !== undefined) move.push(`Z${params.z}`);
    if (params.speed !== undefined) move.push(`F${params.speed}`);
    parts.push(move.join(' '));
    parts.push('G90'); // back to absolute
    return this.sendGcode(parts.join('\n'));
  }

  async moveAbsolute(params: {
    x?: number;
    y?: number;
    z?: number;
    speed?: number;
  }): Promise<ApiResult<void>> {
    const move = ['G1'];
    if (params.x !== undefined) move.push(`X${params.x}`);
    if (params.y !== undefined) move.push(`Y${params.y}`);
    if (params.z !== undefined) move.push(`Z${params.z}`);
    if (params.speed !== undefined) move.push(`F${params.speed}`);
    return this.sendGcode(move.join(' '));
  }

  async emergencyStop(): Promise<ApiResult<void>> {
    return this.post('/printer/emergency_stop');
  }

  async firmwareRestart(): Promise<ApiResult<void>> {
    return this.post('/printer/firmware_restart');
  }

  // ─── Extrusion ─────────────────────────────────────────

  async extrude(length: number, speed = 300): Promise<ApiResult<void>> {
    return this.sendGcode(`M83\nG1 E${length} F${speed}`);
  }

  async retract(length: number, speed = 300): Promise<ApiResult<void>> {
    return this.sendGcode(`M83\nG1 E-${Math.abs(length)} F${speed}`);
  }

  async resetExtruder(): Promise<ApiResult<void>> {
    return this.sendGcode('G92 E0');
  }

  // ─── Print Control ─────────────────────────────────────

  async startPrint(filename: string): Promise<ApiResult<void>> {
    return this.post('/printer/print/start', { filename });
  }

  async pausePrint(): Promise<ApiResult<void>> {
    return this.post('/printer/print/pause');
  }

  async resumePrint(): Promise<ApiResult<void>> {
    return this.post('/printer/print/resume');
  }

  async cancelPrint(): Promise<ApiResult<void>> {
    return this.post('/printer/print/cancel');
  }

  // ─── Files ─────────────────────────────────────────────

  async listFiles(root = 'gcodes'): Promise<ApiResult<GcodeFile[]>> {
    const res = await this.get<any>(
      `/server/files/list?root=${encodeURIComponent(root)}`,
    );
    if (!res.success || !res.data) return { success: false, error: res.error };

    const entries: any[] = res.data.files ?? res.data ?? [];
    const files = this.flattenGcodeFiles(entries);
    return { success: true, data: files };
  }

  async getFileMetadata(filename: string): Promise<ApiResult<GcodeFileMetadata>> {
    const res = await this.get<any>(
      `/server/files/metadata?filename=${encodeURIComponent(filename)}`,
    );
    if (!res.success || !res.data) return { success: false, error: res.error };

    const d = res.data;
    const thumbnails: Thumbnail[] = (d.thumbnails ?? []).map((t: any) => ({
      width: t.width ?? 0,
      height: t.height ?? 0,
      size: t.size ?? 0,
      relativePath: t.relative_path ?? t.relativePath ?? '',
    }));

    return {
      success: true,
      data: {
        filename: d.filename ?? filename,
        path: d.filename ?? filename,
        size: Number(d.size ?? 0),
        modified: Number(d.modified ?? 0),
        estimatedTime: d.estimated_time ?? null,
        filamentTotal: d.filament_total ?? null,
        filamentWeight: d.filament_weight_total ?? null,
        layerHeight: d.layer_height ?? null,
        firstLayerHeight: d.first_layer_height ?? null,
        objectHeight: d.object_height ?? null,
        thumbnails,
        slicer: d.slicer ?? null,
        slicerVersion: d.slicer_version ?? null,
      },
    };
  }

  async deleteFile(filename: string, root = 'gcodes'): Promise<ApiResult<void>> {
    return this.request(`/server/files/${root}/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
  }

  /** Upload a G-code file to Moonraker */
  async uploadFile(
    file: File | Blob,
    filename: string,
    root = 'gcodes',
  ): Promise<ApiResult<void>> {
    return this.uploadFileWithProgress(file, filename, root);
  }

  /** Upload a G-code file with real-time progress callback */
  uploadFileWithProgress(
    file: File | Blob,
    filename: string,
    root = 'gcodes',
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<ApiResult<void>> {
    return new Promise((resolve) => {
      const formData = new FormData();
      formData.append('file', file, filename);
      formData.append('root', root);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.baseUrl}/server/files/upload`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(e.loaded, e.total);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: `HTTP ${xhr.status}` });
        }
      };

      xhr.onerror = () => {
        resolve({ success: false, error: 'Ошибка сети' });
      };

      xhr.ontimeout = () => {
        resolve({ success: false, error: 'Таймаут загрузки' });
      };

      xhr.send(formData);
    });
  }

  /** Get thumbnail URL for a G-code file */
  getThumbnailUrl(relativePath: string): string {
    return `${this.baseUrl}/server/files/gcodes/${relativePath}`;
  }

  // ─── Print History ─────────────────────────────────────

  async getPrintHistory(limit = 50): Promise<ApiResult<PrintHistoryJob[]>> {
    const res = await this.get<any>(
      `/server/history/list?limit=${limit}&order=desc`,
    );
    if (!res.success || !res.data) return { success: false, error: res.error };

    const jobs: any[] = res.data.jobs ?? res.data ?? [];
    const history: PrintHistoryJob[] = jobs.map((j) => ({
      jobId: j.job_id ?? '',
      filename: j.filename ?? '',
      status: j.status ?? '',
      startTime: Number(j.start_time ?? 0),
      endTime: j.end_time ? Number(j.end_time) : null,
      totalDuration: Number(j.total_duration ?? 0),
      printDuration: Number(j.print_duration ?? 0),
      filamentUsed: Number(j.filament_used ?? 0),
      metadata: j.metadata ?? null,
      thumbnailRelativePath: null, // populated lazily
    }));

    return { success: true, data: history };
  }

  // ─── Macros ────────────────────────────────────────────

  async listMacros(): Promise<ApiResult<GcodeMacro[]>> {
    const res = await this.get<any>('/printer/objects/list');
    if (!res.success || !res.data) return { success: false, error: res.error };

    const objects: string[] = res.data.objects ?? [];
    const macros: GcodeMacro[] = objects
      .filter((o) => typeof o === 'string' && o.startsWith('gcode_macro '))
      .map((o) => ({ name: o.slice('gcode_macro '.length) }))
      .filter((m) => m.name.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    return { success: true, data: macros };
  }

  async runMacro(name: string): Promise<ApiResult<void>> {
    return this.sendGcode(name);
  }

  // ─── Helpers ───────────────────────────────────────────

  private flattenGcodeFiles(entries: any[], parentPath = 'gcodes'): GcodeFile[] {
    const out: GcodeFile[] = [];
    for (const entry of entries) {
      const name: string = entry?.filename ?? entry?.name ?? entry?.path ?? '';
      const type: string = entry?.type ?? (entry?.children ? 'directory' : 'file');
      const relPath: string = entry?.path ?? `${parentPath}/${name}`;

      if (type === 'directory' || Array.isArray(entry?.children)) {
        out.push(...this.flattenGcodeFiles(entry?.children ?? [], relPath));
      } else if (/\.gcode$/i.test(name)) {
        out.push({
          filename: name,
          path: relPath,
          size: Number(entry?.size ?? 0),
          modified: Number(entry?.modified ?? 0),
        });
      }
    }
    return out;
  }
}
