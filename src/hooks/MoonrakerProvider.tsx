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
  useMemo,
  useCallback,
  type ReactNode,
} from 'react';
import { useStore } from 'zustand';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { MoonrakerClient } from '../api/moonraker-client';
import { MoonrakerWebSocket, wsUrlFromHttp } from '../api/moonraker-ws';
import type { ConnectionMode, PrinterStatus, MoonrakerConfig } from '../api/types';
import { createPoller } from '../utils/poller';
import {
  createPrinterStore,
  type PrinterStore,
  type PrinterStoreState,
} from '../store/printer-store';

// ─── Context Shape ─────────────────────────────────────────

/**
 * Only stable references live in context — identity never changes between
 * ticks. Reactive state (status / connection flags) lives in the zustand
 * store and is read via `useStore(ctx.store)` so an unchanged tick (which
 * `applyStatus` short-circuits) triggers no re-render.
 */
interface MoonrakerContextValue {
  /** REST API client */
  client: MoonrakerClient;
  /** WebSocket client for real-time data */
  ws: MoonrakerWebSocket;
  /** Connection config */
  config: MoonrakerConfig;
  /** Force a status refresh */
  refresh: () => Promise<void>;
  /** Reactive printer store (status + connection flags) */
  store: PrinterStore;
}

/** Public shape returned by {@link useMoonraker} — unchanged from before. */
export interface MoonrakerValue {
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
  // Stable config reference
  const config: MoonrakerConfig = useMemo(
    () => ({ baseUrl, mode, pollInterval }),
    [baseUrl, mode, pollInterval],
  );

  // REST client
  const client = useMemo(() => new MoonrakerClient(config), [config]);

  // Reactive printer store — created once per provider instance.
  const store = useMemo(() => createPrinterStore(), [client]);

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
        store.getState().applyStatus(result.data);
        store.getState().setConnection({ isConnected: true, error: null });
      } else {
        store.getState().setConnection({
          isConnected: false,
          error: result.error ?? 'Failed to fetch printer status',
        });
      }
    } catch (err: any) {
      store.getState().setConnection({
        isConnected: false,
        error: err?.message ?? 'Connection error',
      });
    }
  }, [client, store]);

  // Poll on interval — createPoller guarantees no overlapping requests
  // (a hung Moonraker used to stack timed-out requests every 2 s).
  //
  // Cadence is dynamic: while the WS is live, REST polling backs off to a
  // 15 s heartbeat (a safety net against missed WS notifications); once the
  // WS drops, it snaps back to client.pollInterval so the UI still updates
  // promptly without a live push channel.
  useEffect(() => {
    const HEARTBEAT_MS = 15_000;
    const poller = createPoller(refresh, client.pollInterval);
    poller.start();
    const unsub = store.subscribe(
      (s) => s.wsConnected,
      (wsConnected) => poller.setInterval(wsConnected ? HEARTBEAT_MS : client.pollInterval),
    );
    return () => { unsub(); poller.stop(); };
  }, [refresh, client.pollInterval, store]);

  // ─── WebSocket ───────────────────────────────────────

  useEffect(() => {
    if (disableWebSocket) return;

    // Listen for connection state
    ws.on('connection', (data: any) => {
      store.getState().setConnection({ wsConnected: data.connected === true });

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
      const prev = store.getState().status;
      if (!prev) return;
      store.getState().applyStatus(mergeStatusUpdate(prev, data));
    });

    ws.connect();

    return () => {
      ws.disconnect();
    };
  }, [ws, disableWebSocket, store]);

  // ─── Context Value ───────────────────────────────────

  const value = useMemo<MoonrakerContextValue>(
    () => ({ client, ws, config, refresh, store }),
    [client, ws, config, refresh, store],
  );

  return (
    <MoonrakerContext.Provider value={value}>
      {children}
    </MoonrakerContext.Provider>
  );
}

// ─── Hooks ─────────────────────────────────────────────────

/**
 * Prior public API — now assembled from the stable context plus a full
 * store subscription. Because `applyStatus` reconciles and skips `set`
 * when the tick is unchanged, an unchanged poll causes NO re-render of
 * consumers of this hook.
 */
export function useMoonraker(): MoonrakerValue {
  const ctx = useContext(MoonrakerContext);
  if (!ctx) {
    throw new Error('useMoonraker must be used within <MoonrakerProvider>');
  }
  const state = useStore(ctx.store);
  return useMemo(
    () => ({
      client: ctx.client,
      ws: ctx.ws,
      config: ctx.config,
      refresh: ctx.refresh,
      status: state.status,
      isConnected: state.isConnected,
      wsConnected: state.wsConnected,
      error: state.error,
    }),
    [ctx, state],
  );
}

/**
 * Narrow store subscription — for the refactored hot hooks and any consumer
 * that only depends on a slice of printer state. Re-renders only when the
 * selected slice changes (structural sharing keeps slice identity stable
 * across unchanged ticks).
 *
 * zustand v5 removed the equality argument from `useStore`; the custom-
 * equality path routes through `useStoreWithEqualityFn` from
 * `zustand/traditional`.
 */
export function usePrinterSelector<T>(
  selector: (s: PrinterStoreState) => T,
  equalityFn?: (a: T, b: T) => boolean,
): T {
  const ctx = useContext(MoonrakerContext);
  if (!ctx) {
    throw new Error('usePrinterSelector must be used within <MoonrakerProvider>');
  }
  // `useStoreWithEqualityFn` defaults to `Object.is` when no equalityFn is
  // given — identical to plain `useStore(store, selector)` — so a single
  // unconditional call covers both paths without violating rules-of-hooks.
  return useStoreWithEqualityFn(ctx.store, selector, equalityFn);
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
