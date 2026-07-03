/**
 * MoonrakerClient — platform-agnostic REST client for Moonraker API.
 *
 * Works in both browser (React renderer) and Node.js (Electron main) contexts
 * using native fetch(). No Electron or axios dependency.
 *
 * On iOS, requests to CGNAT VPN addresses (100.64.x.x) are routed through
 * NativeHTTPModule which uses Network.framework NWConnection to bypass ATS,
 * since NSAllowsArbitraryLoads does not exempt NSURLSession on iOS 26+.
 */
import { NativeModules, Platform } from 'react-native';
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

  /**
   * Returns true when requests to this URL should use NativeHTTPModule
   * (Network.framework NWConnection) instead of fetch() to bypass iOS ATS.
   * Applies to CGNAT VPN addresses (100.64.0.0/10) on iOS.
   */
  private shouldUseNativeHTTP(url: string): boolean {
    if (Platform.OS !== 'ios') return false;
    if (!NativeModules.NativeHTTPModule) return false;
    try {
      const host = new URL(url).hostname;
      // 100.64.0.0/10 — first octet 100, second octet 64–127
      const parts = host.split('.').map(Number);
      return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
    } catch {
      return false;
    }
  }

  private async nativeRequest<T>(
    url: string,
    options: RequestInit = {},
  ): Promise<ApiResult<T>> {
    const method = (options.method ?? 'GET').toUpperCase();
    const body = options.body != null ? String(options.body) : null;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> ?? {}),
    };

    try {
      const result: { status: number; body: string } =
        await NativeModules.NativeHTTPModule.request(url, method, headers, body);

      if (result.status >= 400) {
        return { success: false, error: `HTTP ${result.status}` };
      }

      const json = JSON.parse(result.body);
      return { success: true, data: json.result ?? json };
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'NativeHTTP error' };
    }
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<ApiResult<T>> {
    const url = `${this.baseUrl}${path}`;

    if (this.shouldUseNativeHTTP(url)) {
      let lastError = 'Unknown error';
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        const result = await this.nativeRequest<T>(url, options);
        if (result.success) return result;
        lastError = result.error ?? lastError;
        // Don't retry 4xx
        if (lastError.startsWith('HTTP 4')) return result;
        if (attempt < this.maxRetries) {
          await new Promise<void>((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      return { success: false, error: lastError };
    }

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
          await new Promise<void>((r) => setTimeout(r, 500 * (attempt + 1)));
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

  /**
   * Klipper's own state + human-readable reason from `/printer/info`.
   * `state` is authoritative (unlike the hardcoded klipperState in getPrinterStatus).
   * `stateMessage` carries the shutdown/error reason text.
   */
  async getPrinterInfo(): Promise<ApiResult<{ state: KlipperState; stateMessage: string }>> {
    const res = await this.get<any>('/printer/info');
    if (!res.success || !res.data) return res as ApiResult<{ state: KlipperState; stateMessage: string }>;
    const d = res.data;
    return {
      success: true,
      data: {
        state: (d.state as KlipperState) ?? 'ready',
        stateMessage: typeof d.state_message === 'string' ? d.state_message : '',
      },
    };
  }

  /**
   * Klipper config warnings (deprecated options, invalid sections) plus whether a
   * SAVE_CONFIG is pending. Sourced from the `configfile` printer object.
   */
  async getConfigWarnings(): Promise<ApiResult<{ warnings: string[]; saveConfigPending: boolean }>> {
    const res = await this.get<any>('/printer/objects/query?configfile');
    if (!res.success || !res.data) return res as ApiResult<{ warnings: string[]; saveConfigPending: boolean }>;
    const cf = res.data?.status?.configfile ?? {};
    const raw = Array.isArray(cf.warnings) ? cf.warnings : [];
    const warnings = raw
      .map((w: any) => (typeof w === 'string' ? w : (w?.message ?? '')))
      .filter((s: string) => s.trim().length > 0);
    return {
      success: true,
      data: { warnings, saveConfigPending: cf.save_config_pending === true },
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
      'heater_generic Active_Chamber',
      'heater_generic Drying_Chamber_1',
      'heater_generic Drying_Chamber_2',
      'temperature_sensor bed_glass',
      ...fsNames.map((n) => `filament_switch_sensor ${n}`),
      ...fsNames.map((n) => `filament_motion_sensor ${n}`),
      'bed_mesh',
    ];

    const query = objects.map((o) => encodeURIComponent(o)).join('&');
    const res = await this.get<any>(`/printer/objects/query?${query}`);
    if (!res.success || !res.data) return { success: false, error: res.error };

    const status = res.data.status ?? res.data;
    return { success: true, data: this.parsePrinterStatus(status) };
  }

  // ─── Bed Size from Klipper Config ───────────────────────

  /**
   * Read printer bed dimensions from Klipper's `configfile.config` block.
   * Returns null if the config doesn't have stepper position_max values.
   */
  async getBedSize(): Promise<ApiResult<[number, number, number]>> {
    const res = await this.get<any>('/printer/objects/query?configfile');
    if (!res.success || !res.data) return res as ApiResult<[number, number, number]>;
    const cfg = res.data?.status?.configfile?.config;
    if (!cfg) return { success: false, error: 'configfile.config missing' };
    const num = (v: unknown): number | null => {
      const n = typeof v === 'string' ? parseFloat(v) : (typeof v === 'number' ? v : NaN);
      return Number.isFinite(n) ? n : null;
    };
    const x = num(cfg?.stepper_x?.position_max);
    const y = num(cfg?.stepper_y?.position_max);
    const z = num(cfg?.stepper_z?.position_max);
    if (x == null || y == null || z == null) {
      return { success: false, error: 'stepper position_max not found' };
    }
    return { success: true, data: [x, y, z] };
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
    const temperatures: TemperatureData = {
      extruder: this.parseHeater(obj.extruder),
      extruder1: this.parseHeater(obj.extruder1),
      heaterBed: this.parseHeater(obj.heater_bed),
      heaterChamber: this.parseHeater(obj['heater_generic Active_Chamber']),
      dryingChamber1: this.parseHeater(obj['heater_generic Drying_Chamber_1']),
      dryingChamber2: this.parseHeater(obj['heater_generic Drying_Chamber_2']),
      bedGlass: this.parseHeater(obj['temperature_sensor bed_glass']),
    };

    // Toolhead
    const th = obj.toolhead ?? {};
    const pos = th.position ?? [0, 0, 0, 0];
    const axisMin = Array.isArray(th.axis_minimum) ? th.axis_minimum : null;
    const axisMax = Array.isArray(th.axis_maximum) ? th.axis_maximum : null;
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
      axisMinimum: axisMin
        ? { x: Number(axisMin[0] ?? 0), y: Number(axisMin[1] ?? 0), z: Number(axisMin[2] ?? 0) }
        : null,
      axisMaximum: axisMax
        ? { x: Number(axisMax[0] ?? 0), y: Number(axisMax[1] ?? 0), z: Number(axisMax[2] ?? 0) }
        : null,
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

    // Bed mesh
    const bm = obj.bed_mesh;
    const bedMesh = bm ? {
      profileName: bm.profile_name ?? '',
      meshMin: bm.mesh_min ?? [0, 0],
      meshMax: bm.mesh_max ?? [0, 0],
      probedMatrix: bm.probed_matrix ?? [],
      meshMatrix: bm.mesh_matrix ?? [],
      profiles: bm.profiles ?? {},
    } : null;

    return {
      klipperState: 'ready',
      printStats,
      temperatures,
      toolhead,
      virtualSdCard,
      filamentSensors,
      bedMesh,
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

  // ─── G-code ────────────────────────────────────────────

  async sendGcode(script: string): Promise<ApiResult<void>> {
    return this.post('/printer/gcode/script', { script });
  }

  /**
   * Fetch cached G-code console history from Moonraker's gcode_store.
   * Returns an array of {type, message, time} entries.
   */
  async getGcodeStore(count = 200): Promise<ApiResult<{type: string; message: string; time: number}[]>> {
    const result = await this.get<{gcode_store: {type: string; message: string; time: number}[]}>(
      `/server/gcode_store?count=${count}`,
    );
    if (result.success && result.data) {
      return {success: true, data: result.data.gcode_store ?? []};
    }
    return {success: false, error: result.error};
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
    (formData as any).append('file', file, filename);
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

  /**
   * Fetch a thumbnail image as a data: URI via NativeHTTPModule (bypasses ATS).
   * Falls back to the regular HTTP URL on non-iOS or when NativeHTTPModule is unavailable.
   */
  async fetchThumbnailDataUri(relativePath: string): Promise<string | null> {
    const url = this.getThumbnailUrl(relativePath);
    if (this.shouldUseNativeHTTP(url)) {
      try {
        const dataUri: string = await NativeModules.NativeHTTPModule.fetchBase64(url);
        return dataUri;
      } catch {
        return null;
      }
    }
    // Non-iOS or non-CGNAT: return regular URL (Image can fetch it)
    return url;
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

  // ─── Config Files ────────────────────────────────────────

  async listConfigFiles(): Promise<ApiResult<{path: string; filename: string; size: number; modified: number}[]>> {
    const res = await this.get<any>('/server/files/list?root=config');
    if (!res.success) return { success: false, error: res.error };
    const files = (res.data ?? []).map((f: any) => {
      const p = f.path ?? f.filename ?? '';
      return {
        path: p,
        filename: p.split('/').pop() || p,
        size: f.size ?? 0,
        modified: f.modified ?? 0,
      };
    });
    return { success: true, data: files };
  }

  async getConfigFileContent(filename: string): Promise<ApiResult<string>> {
    const url = `${this.baseUrl}/server/files/config/${encodeURIComponent(filename)}`;
    try {
      if (this.shouldUseNativeHTTP(url)) {
        // Use NativeHTTPModule directly — config files are plain text, not JSON
        const result: { status: number; body: string } =
          await NativeModules.NativeHTTPModule.request(url, 'GET', {}, null);
        if (result.status >= 400) return { success: false, error: `HTTP ${result.status}` };
        return { success: true, data: result.body ?? '' };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
      const text = await resp.text();
      return { success: true, data: text };
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'Failed to read file' };
    }
  }

  async saveConfigFile(filename: string, content: string): Promise<ApiResult<void>> {
    const url = `${this.baseUrl}/server/files/upload`;
    try {
      const formData = new FormData();
      (formData as any).append('file', new Blob([content]), filename);
      formData.append('root', 'config');
      const resp = await fetch(url, { method: 'POST', body: formData });
      if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'Failed to save file' };
    }
  }

  // ─── Job Queue ────────────────────────────────────────

  async getJobQueue(): Promise<ApiResult<{queued_jobs: any[]; queue_state: string}>> {
    return this.get<{queued_jobs: any[]; queue_state: string}>('/server/job_queue/status');
  }

  async enqueueJob(filenames: string[]): Promise<ApiResult<void>> {
    return this.request('/server/job_queue/job', { method: 'POST', body: JSON.stringify({ filenames }) });
  }

  async deleteQueueJob(jobIds: string[]): Promise<ApiResult<void>> {
    return this.request(`/server/job_queue/job?job_ids=${jobIds.join(',')}`, { method: 'DELETE' });
  }

  async startQueue(): Promise<ApiResult<void>> {
    return this.request('/server/job_queue/start', { method: 'POST' });
  }

  async pauseQueue(): Promise<ApiResult<void>> {
    return this.request('/server/job_queue/pause', { method: 'POST' });
  }

  async clearQueue(): Promise<ApiResult<void>> {
    return this.request('/server/job_queue/job', { method: 'DELETE' });
  }

  // ─── System Info ────────────────────────────────────────

  async getSystemInfo(): Promise<ApiResult<any>> {
    const res = await this.get<any>('/machine/system_info');
    if (!res.success) return res;
    const raw = res.data?.system_info ?? res.data ?? {};
    const ci = raw.cpu_info;
    return { success: true, data: {
      cpuInfo: ci ? { cpuCount: ci.cpu_count, model: ci.model ?? ci.processor ?? '', totalMemory: ci.total_memory ?? 0 } : undefined,
      sdInfo: raw.sd_info,
      distribution: raw.distribution,
      network: raw.network,
      serviceState: raw.service_state ? Object.fromEntries(
        Object.entries(raw.service_state).map(([k, v]: [string, any]) => [k, { activeState: v.active_state, subState: v.sub_state }])
      ) : undefined,
    }};
  }

  async getProcStats(): Promise<ApiResult<any>> {
    const res = await this.get<any>('/machine/proc_stats');
    if (!res.success) return res;
    const raw = res.data ?? {};
    return { success: true, data: {
      cpuTemp: raw.cpu_temp,
      systemCpuUsage: raw.system_cpu_usage,
      systemMemory: raw.system_memory,
      systemUptime: raw.system_uptime,
      websocketConnections: raw.websocket_connections,
      throttledState: raw.throttled_state ? { bits: raw.throttled_state.bits, flags: raw.throttled_state.flags ?? [] } : undefined,
    }};
  }

  async restartService(service: string): Promise<ApiResult<void>> {
    return this.request(`/machine/services/restart?service=${service}`, { method: 'POST' });
  }

  async restartServer(): Promise<ApiResult<void>> {
    return this.request('/server/restart', { method: 'POST' });
  }

  async rebootHost(): Promise<ApiResult<void>> {
    return this.request('/machine/reboot', { method: 'POST' });
  }

  async shutdownHost(): Promise<ApiResult<void>> {
    return this.request('/machine/shutdown', { method: 'POST' });
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
