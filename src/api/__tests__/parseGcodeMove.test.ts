/**
 * parsePrinterStatus — gcode_move slice.
 *
 * The REST poll rebuilds the whole `gcodeMove` slice on every tick, so any
 * field parsed ONLY in the WebSocket merge gets wiped every heartbeat. That is
 * exactly what happened to `gcodePosition`: it appeared on WS updates and
 * vanished 15 s later, so a consumer preferring it silently flipped between
 * two coordinate systems (gcode_position honours homing_origin, toolhead
 * .position does not). Both transports must agree.
 */
import {describe, test, expect} from 'vitest';
import {MoonrakerClient} from '../moonraker-client';

/** parsePrinterStatus is private; reach it the way the client itself does. */
function parse(objects: Record<string, unknown>) {
  const client = new MoonrakerClient({baseUrl: 'http://localhost:7125', mode: 'local'});
  return (client as unknown as {
    parsePrinterStatus: (o: Record<string, unknown>) => {gcodeMove: {gcodePosition?: unknown; speedFactor: number}};
  }).parsePrinterStatus(objects);
}

describe('parsePrinterStatus gcode_move', () => {
  test('parses gcode_position from the REST snapshot', () => {
    const status = parse({gcode_move: {gcode_position: [11.5, 22.5, 3.25, 4]}});
    expect(status.gcodeMove.gcodePosition).toEqual({x: 11.5, y: 22.5, z: 3.25, e: 4});
  });

  test('omits gcode_position when the printer does not report it', () => {
    const status = parse({gcode_move: {speed_factor: 0.5}});
    expect(status.gcodeMove.gcodePosition).toBeUndefined();
    expect(status.gcodeMove.speedFactor).toBe(0.5);
  });
});
