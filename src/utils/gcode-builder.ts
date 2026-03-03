/**
 * Type-safe G-code command builders for Klipper.
 *
 * Usage:
 *   gcode.home()                        → "G28"
 *   gcode.home('x', 'z')               → "G28 X Z"
 *   gcode.move({ x: 10, y: 20 })       → "G1 X10 Y20"
 *   gcode.setExtruderTemp(220)          → "M104 S220"
 *   gcode.setBedTemp(60)                → "M140 S60"
 */

export interface MoveParams {
  x?: number;
  y?: number;
  z?: number;
  e?: number;
  /** Feed rate in mm/min */
  speed?: number;
}

// ─── Motion ──────────────────────────────────────────────

/** Home axes. No args = home all. */
export function home(...axes: ('x' | 'y' | 'z')[]): string {
  if (axes.length === 0) return 'G28';
  return `G28 ${axes.map((a) => a.toUpperCase()).join(' ')}`;
}

/** Absolute move (G90 + G1) */
export function moveAbsolute(params: MoveParams): string {
  return `G90\n${buildG1(params)}`;
}

/** Relative move (G91 + G1 + G90) */
export function moveRelative(params: MoveParams): string {
  return `G91\n${buildG1(params)}\nG90`;
}

function buildG1(p: MoveParams): string {
  const parts = ['G1'];
  if (p.x !== undefined) parts.push(`X${p.x}`);
  if (p.y !== undefined) parts.push(`Y${p.y}`);
  if (p.z !== undefined) parts.push(`Z${p.z}`);
  if (p.e !== undefined) parts.push(`E${p.e}`);
  if (p.speed !== undefined) parts.push(`F${p.speed}`);
  return parts.join(' ');
}

/** Set absolute positioning mode */
export function absolute(): string {
  return 'G90';
}

/** Set relative positioning mode */
export function relative(): string {
  return 'G91';
}

// ─── Temperature ─────────────────────────────────────────

/** M104 — set hotend target temp (non-blocking) */
export function setExtruderTemp(target: number, tool = 0): string {
  return tool === 0
    ? `M104 S${target}`
    : `M104 T${tool} S${target}`;
}

/** M109 — set hotend target and wait */
export function setExtruderTempWait(target: number, tool = 0): string {
  return tool === 0
    ? `M109 S${target}`
    : `M109 T${tool} S${target}`;
}

/** M140 — set bed target temp (non-blocking) */
export function setBedTemp(target: number): string {
  return `M140 S${target}`;
}

/** M190 — set bed target and wait */
export function setBedTempWait(target: number): string {
  return `M190 S${target}`;
}

/** Klipper SET_HEATER_TEMPERATURE for any heater */
export function setHeaterTemp(heater: string, target: number): string {
  return `SET_HEATER_TEMPERATURE HEATER=${heater} TARGET=${target}`;
}

/** Turn off all heaters */
export function turnOffHeaters(): string {
  return 'TURN_OFF_HEATERS';
}

// ─── Extrusion ───────────────────────────────────────────

/** Extrude filament (relative mode) */
export function extrude(length: number, speed = 300): string {
  return `M83\nG1 E${length} F${speed}`;
}

/** Retract filament (relative mode) */
export function retract(length: number, speed = 300): string {
  return `M83\nG1 E-${Math.abs(length)} F${speed}`;
}

/** Reset extruder position to zero */
export function resetExtruder(): string {
  return 'G92 E0';
}

// ─── Fan ─────────────────────────────────────────────────

/** M106 — set part cooling fan speed (0-255 or 0.0-1.0) */
export function setFanSpeed(speed: number): string {
  const val = speed <= 1 ? Math.round(speed * 255) : Math.round(speed);
  return `M106 S${Math.min(255, Math.max(0, val))}`;
}

/** M107 — turn off part cooling fan */
export function fanOff(): string {
  return 'M107';
}

// ─── Misc ────────────────────────────────────────────────

/** Emergency stop */
export function emergencyStop(): string {
  return 'M112';
}

/** Firmware restart (Klipper) */
export function firmwareRestart(): string {
  return 'FIRMWARE_RESTART';
}

/** Disable steppers */
export function disableSteppers(): string {
  return 'M84';
}

/** Set speed override factor (100 = normal) */
export function setSpeedFactor(percent: number): string {
  return `M220 S${Math.round(percent)}`;
}

/** Set extrusion flow factor (100 = normal) */
export function setFlowFactor(percent: number): string {
  return `M221 S${Math.round(percent)}`;
}

/** Build multi-line G-code from array of commands */
export function batch(...commands: string[]): string {
  return commands.join('\n');
}
