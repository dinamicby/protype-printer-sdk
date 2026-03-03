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
  PrintState,
  KlipperState,
  MoonrakerServerInfo,
  GcodeMacro,
  FilamentSensorState,
  Thumbnail,
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
      'toolhead',
      'extruder',
      'extruder1',
      'heater_bed',
      'heater_generic heater_chamber',
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

    // Temperatures
    const temperatures = {
      extruder: this.parseHeater(obj.extruder),
      extruder1: this.parseHeater(obj.extruder1),
      heaterBed: this.parseHeater(obj.heater_bed),
      heaterChamber: this.parseHeater(obj['heater_generic heater_chamber']),
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

    // Computed
    const progress = virtualSdCard.progress;
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
    return this.sendGcode(`SET_HEATER_TEMPERATURE HEATER=heater_chamber TARGET=${target}`);
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
    const formData = new FormData();
    formData.append('file', file, filename);
    formData.append('root', root);

    const url = `${this.baseUrl}/server/files/upload`;
    try {
      const resp = await fetch(url, { method: 'POST', body: formData });
      if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'Upload failed' };
    }
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
