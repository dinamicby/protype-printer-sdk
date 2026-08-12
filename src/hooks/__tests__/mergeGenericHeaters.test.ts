/**
 * WebSocket merge for `heater_generic` objects.
 *
 * Once the socket is up the REST poll backs off to a 15 s heartbeat, so these
 * deltas ARE the live temperature for the chamber and dryer cards. They arrive
 * keyed by the printer's own object name, which is not knowable up front.
 */
import {describe, test, expect} from 'vitest';
import {mergeStatusUpdate} from '../MoonrakerProvider';
import type {PrinterStatus} from '../../api/types';

function baseStatus(): PrinterStatus {
  return {
    klipperState: 'ready',
    printStats: {state: 'standby', filename: '', totalDuration: 0, printDuration: 0, filamentUsed: 0, message: '', info: {totalLayer: null, currentLayer: null}},
    temperatures: {extruder: null, extruder1: null, heaterBed: null, heaterChamber: null, dryingChamber1: null, dryingChamber2: null, dryingChamber3: null, dryingChamber4: null, genericHeaters: [], bedGlass: null},
    toolhead: {position: {x: 0, y: 0, z: 0, e: 0}, homed: [false, false, false], maxVelocity: 0, maxAccel: 0, printTime: 0, estimatedPrintTime: 0, activeExtruder: 'extruder', axisMinimum: null, axisMaximum: null},
    virtualSdCard: {filePath: '', progress: 0, isActive: false, filePosition: 0, fileSize: 0},
    displayStatus: {progress: 0, message: ''},
    gcodeMove: {speedFactor: 1, extrudeFactor: 1, speed: 0},
    fan: null,
    filamentSensors: [],
    saveVariables: {},
    bedMesh: null,
    progress: 0,
    eta: null,
    elapsedSeconds: 0,
    isConnected: true,
  };
}

describe('generic heaters over the WebSocket', () => {
  test('fills the chamber slot from a vendor-named heater', () => {
    const next = mergeStatusUpdate(baseStatus(), {
      'heater_generic chamber': {temperature: 33.79, target: 0, power: 0},
    });
    expect(next.temperatures.heaterChamber).toMatchObject({temperature: 33.79});
  });

  test("fills the dryer slot from QIDI's dry box", () => {
    const next = mergeStatusUpdate(baseStatus(), {
      'heater_generic heater_box1': {temperature: 33.02, target: 0, power: 0},
    });
    expect(next.temperatures.dryingChamber1).toMatchObject({temperature: 33.02});
  });

  test('a delta about one heater does not blank the other', () => {
    // Klipper pushes only what changed, so a chamber-only tick must leave the
    // dryer card standing.
    const first = mergeStatusUpdate(baseStatus(), {
      'heater_generic chamber': {temperature: 33, target: 0, power: 0},
      'heater_generic heater_box1': {temperature: 40, target: 60, power: 1},
    });
    const second = mergeStatusUpdate(first, {
      'heater_generic chamber': {temperature: 34},
    });

    expect(second.temperatures.heaterChamber).toMatchObject({temperature: 34});
    expect(second.temperatures.dryingChamber1).toMatchObject({temperature: 40, target: 60});
  });

  test('keeps fields the delta omits', () => {
    const first = mergeStatusUpdate(baseStatus(), {
      'heater_generic chamber': {temperature: 33, target: 50, power: 0.7},
    });
    const second = mergeStatusUpdate(first, {'heater_generic chamber': {temperature: 34}});

    expect(second.temperatures.heaterChamber).toEqual({temperature: 34, target: 50, power: 0.7});
  });

  test('leaves the slots alone when the tick has no generic heater', () => {
    const prev = mergeStatusUpdate(baseStatus(), {
      'heater_generic chamber': {temperature: 33, target: 0, power: 0},
    });
    const next = mergeStatusUpdate(prev, {print_stats: {state: 'printing'}});

    expect(next.temperatures.heaterChamber).toMatchObject({temperature: 33});
  });

  test('does not mutate the previous status', () => {
    const prev = baseStatus();
    mergeStatusUpdate(prev, {'heater_generic chamber': {temperature: 33}});
    expect(prev.temperatures.heaterChamber).toBeNull();
    expect(prev.temperatures.genericHeaters).toEqual([]);
  });
});

describe('heaters arriving in the same tick', () => {
  test('keeps every heater in one update', () => {
    // Moonraker batches all changed objects into a single status_update, and
    // temperatures change on every tick — so this is the common case, not a
    // corner one. Each heater used to be merged onto `prev`, so only the last
    // block's heater survived and the rest silently reverted.
    const next = mergeStatusUpdate(baseStatus(), {
      extruder: {temperature: 210.25, target: 210, power: 0.28},
      heater_bed: {temperature: 55.06, target: 55, power: 0.005},
      'heater_generic chamber': {temperature: 33.79, target: 0, power: 0},
    });

    expect(next.temperatures.extruder).toMatchObject({temperature: 210.25});
    expect(next.temperatures.heaterBed).toMatchObject({temperature: 55.06});
    expect(next.temperatures.heaterChamber).toMatchObject({temperature: 33.79});
  });
});
