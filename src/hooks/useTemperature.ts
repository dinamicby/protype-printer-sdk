/**
 * useTemperature — temperature monitoring and control.
 *
 * Reads current/target temperatures for extruder(s), bed, chamber.
 * Provides setters that send G-code commands via MoonrakerClient.
 *
 * Usage:
 *   const { extruder, bed, chamber, setExtruderTemp, setBedTemp } = useTemperature();
 *   <span>{extruder.temperature}°C / {extruder.target}°C</span>
 */
import { useMemo, useCallback } from 'react';
import { useMoonraker } from './MoonrakerProvider';
import type { HeaterState } from '../api/types';

export interface HeaterInfo extends HeaterState {
  /** Is heater actively heating? (target > 0) */
  isHeating: boolean;
  /** Has reached target? (within 2°C) */
  atTarget: boolean;
}

export interface TemperatureValue {
  /** Primary extruder (T0) */
  extruder: HeaterInfo | null;
  /** Second extruder (T1) — null if not present */
  extruder1: HeaterInfo | null;
  /** Heated bed */
  bed: HeaterInfo | null;
  /** Chamber heater — null if not present */
  chamber: HeaterInfo | null;
  /** Drying chamber 1 — null if not present */
  dryingChamber1: HeaterInfo | null;
  /** Drying chamber 2 — null if not present */
  dryingChamber2: HeaterInfo | null;
  /** Bed glass temperature sensor — null if not present */
  bedGlass: HeaterInfo | null;

  // ─── Setters ──────────────────────────────────────
  /** Set extruder target temperature (non-blocking M104) */
  setExtruderTemp: (target: number, tool?: number) => Promise<void>;
  /** Set extruder target and wait (M109) */
  setExtruderTempWait: (target: number, tool?: number) => Promise<void>;
  /** Set bed target temperature (non-blocking M140) */
  setBedTemp: (target: number) => Promise<void>;
  /** Set bed target and wait (M190) */
  setBedTempWait: (target: number) => Promise<void>;
  /** Set chamber heater temperature */
  setChamberTemp: (target: number) => Promise<void>;
  /** Set drying chamber 1 temperature */
  setDryingChamber1Temp: (target: number) => Promise<void>;
  /** Set drying chamber 2 temperature */
  setDryingChamber2Temp: (target: number) => Promise<void>;
  /** Turn off all heaters */
  cooldown: () => Promise<void>;
  /** Preheat to PLA defaults (200/60) */
  preheatPLA: () => Promise<void>;
  /** Preheat to ABS defaults (240/100) */
  preheatABS: () => Promise<void>;
  /** Preheat to PETG defaults (230/80) */
  preheatPETG: () => Promise<void>;
}

function toHeaterInfo(h: HeaterState | null | undefined): HeaterInfo | null {
  if (!h) return null;
  return {
    ...h,
    isHeating: h.target > 0,
    atTarget: h.target > 0 && Math.abs(h.temperature - h.target) <= 2,
  };
}

export function useTemperature(): TemperatureValue {
  const { status, client } = useMoonraker();

  const extruder = useMemo(
    () => toHeaterInfo(status?.temperatures?.extruder),
    [status?.temperatures?.extruder],
  );

  const extruder1 = useMemo(
    () => toHeaterInfo(status?.temperatures?.extruder1),
    [status?.temperatures?.extruder1],
  );

  const bed = useMemo(
    () => toHeaterInfo(status?.temperatures?.heaterBed),
    [status?.temperatures?.heaterBed],
  );

  const chamber = useMemo(
    () => toHeaterInfo(status?.temperatures?.heaterChamber),
    [status?.temperatures?.heaterChamber],
  );

  const dryingChamber1 = useMemo(
    () => toHeaterInfo(status?.temperatures?.dryingChamber1),
    [status?.temperatures?.dryingChamber1],
  );

  const dryingChamber2 = useMemo(
    () => toHeaterInfo(status?.temperatures?.dryingChamber2),
    [status?.temperatures?.dryingChamber2],
  );

  const bedGlass = useMemo(
    () => toHeaterInfo(status?.temperatures?.bedGlass),
    [status?.temperatures?.bedGlass],
  );

  const setExtruderTemp = useCallback(
    async (target: number, tool = 0) => {
      await client.setExtruderTemp(target, tool);
    },
    [client],
  );

  const setExtruderTempWait = useCallback(
    async (target: number, tool = 0) => {
      const cmd = tool === 0 ? `M109 S${target}` : `M109 T${tool} S${target}`;
      await client.sendGcode(cmd);
    },
    [client],
  );

  const setBedTemp = useCallback(
    async (target: number) => {
      await client.setBedTemp(target);
    },
    [client],
  );

  const setBedTempWait = useCallback(
    async (target: number) => {
      await client.sendGcode(`M190 S${target}`);
    },
    [client],
  );

  const setChamberTemp = useCallback(
    async (target: number) => {
      await client.setChamberTemp(target);
    },
    [client],
  );

  const setDryingChamber1Temp = useCallback(
    async (target: number) => {
      await client.sendGcode(`SET_HEATER_TEMPERATURE HEATER=drying_chamber_1 TARGET=${target}`);
    },
    [client],
  );

  const setDryingChamber2Temp = useCallback(
    async (target: number) => {
      await client.sendGcode(`SET_HEATER_TEMPERATURE HEATER=drying_chamber_2 TARGET=${target}`);
    },
    [client],
  );

  const cooldown = useCallback(async () => {
    await client.sendGcode('TURN_OFF_HEATERS');
  }, [client]);

  const preheatPLA = useCallback(async () => {
    await client.setExtruderTemp(200);
    await client.setBedTemp(60);
  }, [client]);

  const preheatABS = useCallback(async () => {
    await client.setExtruderTemp(240);
    await client.setBedTemp(100);
  }, [client]);

  const preheatPETG = useCallback(async () => {
    await client.setExtruderTemp(230);
    await client.setBedTemp(80);
  }, [client]);

  return {
    extruder,
    extruder1,
    bed,
    chamber,
    dryingChamber1,
    dryingChamber2,
    bedGlass,
    setExtruderTemp,
    setExtruderTempWait,
    setBedTemp,
    setBedTempWait,
    setChamberTemp,
    setDryingChamber1Temp,
    setDryingChamber2Temp,
    cooldown,
    preheatPLA,
    preheatABS,
    preheatPETG,
  };
}
