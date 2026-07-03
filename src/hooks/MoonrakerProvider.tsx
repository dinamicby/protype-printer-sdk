/**
 * MoonrakerProvider — React context that manages Moonraker connection.
 *
 * Provides MoonrakerClient (REST) and MoonrakerWebSocket (real-time) to all
 * child components via context. Handles connection lifecycle, auto-reconnect,
 * and status polling.
 *
 * Usage:
 *   <MoonrakerProvider baseUrl="http://192.168.1.2:7125" mode="remote">
 *     <PrinterDashboard />
 *   </MoonrakerProvider>
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
  type ReactNode,
} from 'react';
import { MoonrakerClient } from '../api/moonraker-client';
import { MoonrakerWebSocket, wsUrlFromHttp } from '../api/moonraker-ws';
import type { ConnectionMode, PrinterStatus, MoonrakerConfig } from '../api/types';
import { createPoller } from '../utils/poller';

// ─── Context Shape ─────────────────────────────────────────

interface MoonrakerContextValue {
  /** REST API client */
  client: MoonrakerClient;
  /** WebSocket client for real-time data */
  ws: MoonrakerWebSocket;
  /** Current printer status (from polling + WS) */
  status: PrinterStatus | null;
  /** Whether connected to Moonraker */
  isConnected: boolean;
  /** Whether WebSocket is connected */
  wsConnected: boolean;
  /** Connection error message */
  error: string | null;
  /** Force a status refresh */
  refresh: () => Promise<void>;
  /** Connection config */
  config: MoonrakerConfig;
}

const MoonrakerContext = createContext<MoonrakerContextValue | null>(null);

// ─── Provider Props ────────────────────────────────────────

interface MoonrakerProviderProps {
  children: ReactNode;
  baseUrl: string;
  mode?: ConnectionMode;
  /** Override polling interval in ms */
  pollInterval?: number;
  /** Disable WebSocket (use polling only) */
  disableWebSocket?: boolean;
}

// ─── Provider Component ────────────────────────────────────

export function MoonrakerProvider({
  children,
  baseUrl,
  mode = 'remote',
  pollInterval,
  disableWebSocket = false,
}: MoonrakerProviderProps) {
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable config reference
  const config: MoonrakerConfig = useMemo(
    () => ({ baseUrl, mode, pollInterval }),
    [baseUrl, mode, pollInterval],
  );

  // REST client
  const client = useMemo(() => new MoonrakerClient(config), [config]);

  // WebSocket client
  const wsRef = useRef<MoonrakerWebSocket | null>(null);
  const ws = useMemo(() => {
    const wsUrl = wsUrlFromHttp(baseUrl);
    return new MoonrakerWebSocket({
      url: wsUrl,
      autoReconnect: true,
      reconnectDelay: mode === 'local' ? 1000 : 3000,
    });
  }, [baseUrl, mode]);

  // Keep ref in sync
  useEffect(() => {
    wsRef.current = ws;
  }, [ws]);

  // ─── Polling ─────────────────────────────────────────

  const refresh = useCallback(async () => {
    try {
      const result = await client.getPrinterStatus();
      if (result.success && result.data) {
        setStatus(result.data);
        setIsConnected(true);
        setError(null);
      } else {
        setIsConnected(false);
        setError(result.error ?? 'Failed to fetch printer status');
      }
    } catch (err: any) {
      setIsConnected(false);
      setError(err?.message ?? 'Connection error');
    }
  }, [client]);

  // Poll on interval — createPoller guarantees no overlapping requests
  // (a hung Moonraker used to stack timed-out requests every 2 s).
  useEffect(() => {
    const poller = createPoller(refresh, client.pollInterval);
    poller.start();
    return () => poller.stop();
  }, [refresh, client.pollInterval]);

  // ─── WebSocket ───────────────────────────────────────

  useEffect(() => {
    if (disableWebSocket) return;

    // Listen for connection state
    ws.on('connection', (data: any) => {
      setWsConnected(data.connected === true);

      // When WS connects, subscribe to printer objects
      if (data.connected) {
        ws.subscribeObjects({
          print_stats: null,
          virtual_sdcard: null,
          display_status: null,
          gcode_move: null,
          toolhead: null,
          extruder: null,
          extruder1: null,
          heater_bed: null,
          'heater_generic Active_Chamber': null,
          'heater_generic Drying_Chamber_1': null,
          'heater_generic Drying_Chamber_2': null,
          'heater_generic Drying_Chamber_3': null,
          'heater_generic Drying_Chamber_4': null,
          'temperature_sensor bed_glass': null,
          fan: null,
        }).catch(() => {});
      }
    });

    // Listen for real-time status updates
    ws.on('status_update', (data: any) => {
      if (!data) return;
      // Merge partial update into current status
      setStatus((prev) => {
        if (!prev) return prev;
        return mergeStatusUpdate(prev, data);
      });
    });

    ws.connect();

    return () => {
      ws.disconnect();
    };
  }, [ws, disableWebSocket]);

  // ─── Context Value ───────────────────────────────────

  const value = useMemo<MoonrakerContextValue>(
    () => ({
      client,
      ws,
      status,
      isConnected,
      wsConnected,
      error,
      refresh,
      config,
    }),
    [client, ws, status, isConnected, wsConnected, error, refresh, config],
  );

  return (
    <MoonrakerContext.Provider value={value}>
      {children}
    </MoonrakerContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────

export function useMoonraker(): MoonrakerContextValue {
  const ctx = useContext(MoonrakerContext);
  if (!ctx) {
    throw new Error('useMoonraker must be used within <MoonrakerProvider>');
  }
  return ctx;
}

// ─── Status Merge Helper ───────────────────────────────────

function mergeStatusUpdate(
  prev: PrinterStatus,
  update: Record<string, any>,
): PrinterStatus {
  const next = { ...prev };

  // print_stats — includes info.{total_layer,current_layer} when the slicer
  // emits SET_PRINT_STATS_INFO (PrusaSlicer 2.7+, SuperSlicer, OrcaSlicer).
  if (update.print_stats) {
    const ps = update.print_stats;
    next.printStats = {
      ...prev.printStats,
      ...(ps.state !== undefined && { state: ps.state }),
      ...(ps.filename !== undefined && { filename: ps.filename }),
      ...(ps.total_duration !== undefined && { totalDuration: ps.total_duration }),
      ...(ps.print_duration !== undefined && { printDuration: ps.print_duration }),
      ...(ps.filament_used !== undefined && { filamentUsed: ps.filament_used }),
      ...(ps.message !== undefined && { message: ps.message }),
      ...(ps.info !== undefined && {
        info: {
          totalLayer: ps.info.total_layer ?? prev.printStats.info?.totalLayer ?? null,
          currentLayer: ps.info.current_layer ?? prev.printStats.info?.currentLayer ?? null,
        },
      }),
    };
    next.elapsedSeconds = next.printStats.printDuration;
  }

  // virtual_sdcard
  if (update.virtual_sdcard) {
    const vsd = update.virtual_sdcard;
    next.virtualSdCard = {
      ...prev.virtualSdCard,
      ...(vsd.progress !== undefined && { progress: vsd.progress }),
      ...(vsd.is_active !== undefined && { isActive: vsd.is_active }),
      ...(vsd.file_position !== undefined && { filePosition: vsd.file_position }),
    };
  }

  // display_status — slicer-emitted M73 progress / M117 message.
  if (update.display_status) {
    const ds = update.display_status;
    next.displayStatus = {
      ...(prev.displayStatus ?? { progress: 0, message: '' }),
      ...(ds.progress !== undefined && { progress: ds.progress }),
      ...(ds.message !== undefined && { message: ds.message }),
    };
  }

  // gcode_move
  if (update.gcode_move) {
    const gm = update.gcode_move;
    next.gcodeMove = {
      ...(prev.gcodeMove ?? { speedFactor: 1, extrudeFactor: 1, speed: 0 }),
      ...(gm.speed_factor !== undefined && { speedFactor: gm.speed_factor }),
      ...(gm.extrude_factor !== undefined && { extrudeFactor: gm.extrude_factor }),
      ...(gm.speed !== undefined && { speed: gm.speed }),
    };
  }

  // Computed progress — slicer wins, vsd is fallback.
  next.progress = (next.displayStatus?.progress ?? 0) > 0
    ? next.displayStatus.progress
    : (next.virtualSdCard?.progress ?? 0);

  // Temperatures
  if (update.extruder) {
    next.temperatures = {
      ...prev.temperatures,
      extruder: mergeHeater(prev.temperatures.extruder, update.extruder),
    };
  }
  if (update.extruder1) {
    next.temperatures = {
      ...prev.temperatures,
      extruder1: mergeHeater(prev.temperatures.extruder1, update.extruder1),
    };
  }
  if (update.heater_bed) {
    next.temperatures = {
      ...prev.temperatures,
      heaterBed: mergeHeater(prev.temperatures.heaterBed, update.heater_bed),
    };
  }
  if (update['heater_generic Active_Chamber']) {
    next.temperatures = {
      ...prev.temperatures,
      heaterChamber: mergeHeater(prev.temperatures.heaterChamber, update['heater_generic Active_Chamber']),
    };
  }
  if (update['heater_generic Drying_Chamber_1']) {
    next.temperatures = {
      ...prev.temperatures,
      dryingChamber1: mergeHeater(prev.temperatures.dryingChamber1, update['heater_generic Drying_Chamber_1']),
    };
  }
  if (update['heater_generic Drying_Chamber_2']) {
    next.temperatures = {
      ...prev.temperatures,
      dryingChamber2: mergeHeater(prev.temperatures.dryingChamber2, update['heater_generic Drying_Chamber_2']),
    };
  }
  if (update['heater_generic Drying_Chamber_3']) {
    next.temperatures = {
      ...prev.temperatures,
      dryingChamber3: mergeHeater(prev.temperatures.dryingChamber3, update['heater_generic Drying_Chamber_3']),
    };
  }
  if (update['heater_generic Drying_Chamber_4']) {
    next.temperatures = {
      ...prev.temperatures,
      dryingChamber4: mergeHeater(prev.temperatures.dryingChamber4, update['heater_generic Drying_Chamber_4']),
    };
  }
  if (update['temperature_sensor bed_glass']) {
    next.temperatures = {
      ...prev.temperatures,
      bedGlass: mergeHeater(prev.temperatures.bedGlass, update['temperature_sensor bed_glass']),
    };
  }

  // Part cooling fan
  if (update.fan) {
    const f = update.fan;
    const prevFan = prev.fan ?? { speed: 0, rpm: null };
    next.fan = {
      speed: f.speed !== undefined ? Number(f.speed) : prevFan.speed,
      rpm: f.rpm !== undefined
        ? (f.rpm === null ? null : Number(f.rpm))
        : prevFan.rpm,
    };
  }

  // Toolhead
  if (update.toolhead) {
    const th = update.toolhead;
    if (th.position) {
      next.toolhead = {
        ...prev.toolhead,
        position: {
          x: th.position[0] ?? prev.toolhead.position.x,
          y: th.position[1] ?? prev.toolhead.position.y,
          z: th.position[2] ?? prev.toolhead.position.z,
          e: th.position[3] ?? prev.toolhead.position.e,
        },
      };
    }
  }

  // Recompute ETA
  const progress = next.progress;
  const elapsed = next.elapsedSeconds;
  const etaSeconds = progress > 0
    ? Math.max(0, Math.round(elapsed * (1 / progress - 1)))
    : null;
  next.eta = etaSeconds !== null ? new Date(Date.now() + etaSeconds * 1000) : null;

  return next;
}

function mergeHeater(
  prev: { temperature: number; target: number; power: number } | null,
  update: any,
) {
  if (!prev) {
    return {
      temperature: update.temperature ?? 0,
      target: update.target ?? 0,
      power: update.power ?? 0,
    };
  }
  return {
    temperature: update.temperature ?? prev.temperature,
    target: update.target ?? prev.target,
    power: update.power ?? prev.power,
  };
}
