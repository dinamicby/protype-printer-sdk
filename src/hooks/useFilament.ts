/**
 * useFilament — extrusion controls and filament sensor state.
 *
 * Provides extrude/retract commands and filament sensor readings.
 * Supports up to 8 filament sensors (FS1-FS8) as in Protype printers.
 *
 * Usage:
 *   const { extrude, retract, sensors } = useFilament();
 *   await extrude(50, 300); // extrude 50mm at 300mm/min
 */
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useMoonraker } from './MoonrakerProvider';
import type { FilamentSensorState } from '../api/types';

export interface FilamentValue {
  /** Extrude filament (positive length, relative mode) */
  extrude: (length: number, speed?: number) => Promise<void>;
  /** Retract filament (positive length, relative mode) */
  retract: (length: number, speed?: number) => Promise<void>;
  /** Reset extruder position to zero */
  resetExtruder: () => Promise<void>;
  /** Set extruder to relative mode */
  setRelativeExtrusion: () => Promise<void>;
  /** Set extruder to absolute mode */
  setAbsoluteExtrusion: () => Promise<void>;

  /** Filament sensors state (keyed by sensor name) */
  sensors: Record<string, FilamentSensorState>;
  /** Are all sensors detecting filament? */
  allFilamentPresent: boolean;
  /** Any sensor reporting no filament? */
  anyFilamentOut: boolean;
  /** Number of active sensors */
  sensorCount: number;

  /** Enable/disable a filament sensor */
  setSensorEnabled: (sensorName: string, enabled: boolean) => Promise<void>;
}

export function useFilament(): FilamentValue {
  const { client, ws, status } = useMoonraker();
  const [sensors, setSensors] = useState<Record<string, FilamentSensorState>>({});

  // Extract filament sensor data from status
  useEffect(() => {
    if (!status) return;

    const sensorData: Record<string, FilamentSensorState> = {};

    // Check for filament_switch_sensor objects in status
    // Klipper names: filament_switch_sensor FS1, FS2, etc.
    for (let i = 1; i <= 8; i++) {
      const key = `filament_switch_sensor FS${i}`;
      const raw = (status as any)[key];
      if (raw) {
        sensorData[`FS${i}`] = {
          name: `FS${i}`,
          enabled: raw.enabled ?? true,
          filamentDetected: raw.filament_detected ?? false,
        };
      }
    }

    // Also check generic sensor names
    const genericNames = ['filament_sensor', 'filament_switch_sensor'];
    for (const name of genericNames) {
      const raw = (status as any)[name];
      if (raw) {
        sensorData[name] = {
          name,
          enabled: raw.enabled ?? true,
          filamentDetected: raw.filament_detected ?? false,
        };
      }
    }

    if (Object.keys(sensorData).length > 0) {
      setSensors(sensorData);
    }
  }, [status]);

  // Subscribe to filament sensor updates via WebSocket
  useEffect(() => {
    const objects: Record<string, null> = {};
    for (let i = 1; i <= 8; i++) {
      objects[`filament_switch_sensor FS${i}`] = null;
    }
    ws.subscribeObjects(objects).catch(() => {});
  }, [ws]);

  const extrude = useCallback(
    async (length: number, speed = 300) => {
      await client.extrude(Math.abs(length), speed);
    },
    [client],
  );

  const retract = useCallback(
    async (length: number, speed = 300) => {
      await client.retract(Math.abs(length), speed);
    },
    [client],
  );

  const resetExtruder = useCallback(async () => {
    await client.sendGcode('G92 E0');
  }, [client]);

  const setRelativeExtrusion = useCallback(async () => {
    await client.sendGcode('M83');
  }, [client]);

  const setAbsoluteExtrusion = useCallback(async () => {
    await client.sendGcode('M82');
  }, [client]);

  const sensorValues = Object.values(sensors);

  const allFilamentPresent = useMemo(
    () =>
      sensorValues.length > 0 &&
      sensorValues.every((s) => !s.enabled || s.filamentDetected),
    [sensorValues],
  );

  const anyFilamentOut = useMemo(
    () => sensorValues.some((s) => s.enabled && !s.filamentDetected),
    [sensorValues],
  );

  const sensorCount = sensorValues.length;

  const setSensorEnabled = useCallback(
    async (sensorName: string, enabled: boolean) => {
      const cmd = `SET_FILAMENT_SENSOR SENSOR=${sensorName} ENABLE=${enabled ? 1 : 0}`;
      await client.sendGcode(cmd);
    },
    [client],
  );

  return {
    extrude,
    retract,
    resetExtruder,
    setRelativeExtrusion,
    setAbsoluteExtrusion,
    sensors,
    allFilamentPresent,
    anyFilamentOut,
    sensorCount,
    setSensorEnabled,
  };
}
