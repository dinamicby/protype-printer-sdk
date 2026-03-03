/**
 * useMotion — toolhead motion controls and position tracking.
 *
 * Provides jog (relative move), home, position readout, speed/flow
 * overrides, and emergency stop.
 *
 * Usage:
 *   const { position, jog, home, emergencyStop } = useMotion();
 *   await jog({ x: 10 });      // move X +10mm
 *   await home('x', 'y');       // home X and Y
 */
import { useMemo, useCallback } from 'react';
import { useMoonraker } from './MoonrakerProvider';
import type { Position } from '../api/types';

export interface MotionValue {
  /** Current toolhead position */
  position: Position;

  // ─── Jog Controls ─────────────────────────────────
  /** Relative move (G91 + G1) */
  jog: (params: JogParams) => Promise<void>;
  /** Absolute move (G90 + G1) */
  moveTo: (params: JogParams) => Promise<void>;

  // ─── Homing ───────────────────────────────────────
  /** Home specified axes (or all if none specified) */
  home: (...axes: ('x' | 'y' | 'z')[]) => Promise<void>;
  /** Whether printer is homed (from Klipper status) */
  isHomed: boolean;

  // ─── Emergency ────────────────────────────────────
  /** Emergency stop (M112) */
  emergencyStop: () => Promise<void>;
  /** Firmware restart */
  firmwareRestart: () => Promise<void>;
  /** Disable steppers */
  disableSteppers: () => Promise<void>;

  // ─── Speed / Flow ─────────────────────────────────
  /** Set speed override factor (100 = normal) */
  setSpeedFactor: (percent: number) => Promise<void>;
  /** Set extrusion flow factor (100 = normal) */
  setFlowFactor: (percent: number) => Promise<void>;
}

export interface JogParams {
  x?: number;
  y?: number;
  z?: number;
  /** Feed rate in mm/min */
  speed?: number;
}

export function useMotion(): MotionValue {
  const { status, client } = useMoonraker();

  const position: Position = useMemo(
    () =>
      status?.toolhead?.position ?? { x: 0, y: 0, z: 0, e: 0 },
    [status?.toolhead?.position],
  );

  const isHomed = useMemo(() => {
    if (!status?.toolhead) return false;
    // Klipper reports homed_axes as string like "xyz"
    const homed = (status.toolhead as any).homedAxes ?? '';
    return homed.includes('x') && homed.includes('y') && homed.includes('z');
  }, [status?.toolhead]);

  const jog = useCallback(
    async (params: JogParams) => {
      const speed = params.speed ?? 3000;
      await client.moveRelative({
        x: params.x,
        y: params.y,
        z: params.z,
        speed,
      });
    },
    [client],
  );

  const moveTo = useCallback(
    async (params: JogParams) => {
      const speed = params.speed ?? 3000;
      await client.moveAbsolute({
        x: params.x,
        y: params.y,
        z: params.z,
        speed,
      });
    },
    [client],
  );

  const home = useCallback(
    async (...axes: ('x' | 'y' | 'z')[]) => {
      await client.home(axes.length > 0 ? axes : undefined);
    },
    [client],
  );

  const emergencyStop = useCallback(async () => {
    await client.emergencyStop();
  }, [client]);

  const firmwareRestart = useCallback(async () => {
    await client.firmwareRestart();
  }, [client]);

  const disableSteppers = useCallback(async () => {
    await client.sendGcode('M84');
  }, [client]);

  const setSpeedFactor = useCallback(
    async (percent: number) => {
      await client.sendGcode(`M220 S${Math.round(percent)}`);
    },
    [client],
  );

  const setFlowFactor = useCallback(
    async (percent: number) => {
      await client.sendGcode(`M221 S${Math.round(percent)}`);
    },
    [client],
  );

  return {
    position,
    jog,
    moveTo,
    home,
    isHomed,
    emergencyStop,
    firmwareRestart,
    disableSteppers,
    setSpeedFactor,
    setFlowFactor,
  };
}
