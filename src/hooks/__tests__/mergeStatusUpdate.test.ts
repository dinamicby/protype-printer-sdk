import {describe, test, expect} from 'vitest';
import {mergeStatusUpdate} from '../MoonrakerProvider';
import type {PrinterStatus} from '../../api/types';

function baseStatus(): PrinterStatus {
  return {
    klipperState: 'ready',
    printStats: {state: 'standby', filename: '', totalDuration: 0, printDuration: 0, filamentUsed: 0, message: '', info: {totalLayer: null, currentLayer: null}},
    temperatures: {extruder: null, extruder1: null, heaterBed: null, heaterChamber: null, dryingChamber1: null, dryingChamber2: null, dryingChamber3: null, dryingChamber4: null, bedGlass: null},
    toolhead: {position: {x: 0, y: 0, z: 0, e: 0}, homed: [false, false, false], maxVelocity: 0, maxAccel: 0, printTime: 0, estimatedPrintTime: 0, activeExtruder: 'extruder', axisMinimum: null, axisMaximum: null},
    virtualSdCard: {filePath: '', progress: 0, isActive: false, filePosition: 0, fileSize: 0},
    displayStatus: {progress: 0, message: ''},
    gcodeMove: {speedFactor: 1, extrudeFactor: 1, speed: 0},
    fan: null,
    filamentSensors: [{name: 'FS9', enabled: true, filamentDetected: false}],
    saveVariables: {loaded_1: 0},
    bedMesh: null,
    progress: 0,
    eta: null,
    elapsedSeconds: 0,
    isConnected: true,
  };
}

describe('mergeStatusUpdate filament + save_variables', () => {
  test('updates an existing filament sensor by name', () => {
    const next = mergeStatusUpdate(baseStatus(), {'filament_switch_sensor FS9': {filament_detected: true}});
    expect(next.filamentSensors.find(s => s.name === 'FS9')!.filamentDetected).toBe(true);
  });

  test('adds a new filament sensor not present before', () => {
    const next = mergeStatusUpdate(baseStatus(), {'filament_switch_sensor FS1': {filament_detected: true, enabled: true}});
    expect(next.filamentSensors.find(s => s.name === 'FS1')!.filamentDetected).toBe(true);
  });

  test('merges save_variables partial update immutably', () => {
    const prev = baseStatus();
    const next = mergeStatusUpdate(prev, {save_variables: {variables: {loaded_1: 1, choose_spool_1_remaining: 2950}}});
    expect(next.saveVariables.loaded_1).toBe(1);
    expect(next.saveVariables.choose_spool_1_remaining).toBe(2950);
    expect(prev.saveVariables.loaded_1).toBe(0); // prev unchanged
  });

  test('leaves filament sensors untouched when update has none', () => {
    const next = mergeStatusUpdate(baseStatus(), {print_stats: {state: 'printing'}});
    expect(next.filamentSensors).toHaveLength(1);
  });
});

describe('mergeStatusUpdate toolhead realtime', () => {
  test('merges homed_axes so the UI unlocks right after Home', () => {
    // Without this the homed flags only ever arrived on the REST poll, which
    // backs off to a 15 s heartbeat while the WS is live — presets and the
    // "go to coordinates" button stayed disabled long after the printer had
    // physically finished homing.
    const next = mergeStatusUpdate(baseStatus(), {toolhead: {homed_axes: 'xy'}});
    expect(next.toolhead.homed).toEqual([true, true, false]);
  });

  test('treats an empty homed_axes as fully un-homed', () => {
    const prev = baseStatus();
    prev.toolhead = {...prev.toolhead, homed: [true, true, true]};
    const next = mergeStatusUpdate(prev, {toolhead: {homed_axes: ''}});
    expect(next.toolhead.homed).toEqual([false, false, false]);
  });

  test('keeps homed flags when the update carries only a position', () => {
    const prev = baseStatus();
    prev.toolhead = {...prev.toolhead, homed: [true, true, true]};
    const next = mergeStatusUpdate(prev, {toolhead: {position: [1, 2, 3, 4]}});
    expect(next.toolhead.homed).toEqual([true, true, true]);
    expect(next.toolhead.position).toEqual({x: 1, y: 2, z: 3, e: 4});
  });

  test('merges gcode_position — the live position Mainsail shows', () => {
    const next = mergeStatusUpdate(baseStatus(), {
      gcode_move: {gcode_position: [10, 20, 30, 40]},
    });
    expect(next.gcodeMove.gcodePosition).toEqual({x: 10, y: 20, z: 30, e: 40});
  });

  test('leaves gcode_position alone when the update omits it', () => {
    const prev = baseStatus();
    const next = mergeStatusUpdate(prev, {gcode_move: {speed_factor: 0.5}});
    expect(next.gcodeMove.speedFactor).toBe(0.5);
    expect(next.gcodeMove.gcodePosition).toBeUndefined();
  });
});

describe('mergeStatusUpdate temperatures', () => {
  // Regression: every heater block rebuilt next.temperatures from
  // prev.temperatures, so each one discarded the block before it. A batched WS
  // update carrying several heaters only applied the LAST match — the others
  // stayed stale until the 3 s HTTP poll caught up.
  test('applies extruder and heater_bed carried in the same update', () => {
    const next = mergeStatusUpdate(baseStatus(), {
      extruder: {temperature: 210},
      heater_bed: {temperature: 60},
    });
    expect(next.temperatures.extruder!.temperature).toBe(210);
    expect(next.temperatures.heaterBed!.temperature).toBe(60);
  });

  test('applies every heater carried in the same update', () => {
    const next = mergeStatusUpdate(baseStatus(), {
      extruder: {temperature: 210},
      extruder1: {temperature: 205},
      heater_bed: {temperature: 60},
      'heater_generic Active_Chamber': {temperature: 45},
      'heater_generic Drying_Chamber_1': {temperature: 55},
      'heater_generic Drying_Chamber_2': {temperature: 56},
      'heater_generic Drying_Chamber_3': {temperature: 57},
      'heater_generic Drying_Chamber_4': {temperature: 58},
      'temperature_sensor bed_glass': {temperature: 59},
    });
    expect(next.temperatures.extruder!.temperature).toBe(210);
    expect(next.temperatures.extruder1!.temperature).toBe(205);
    expect(next.temperatures.heaterBed!.temperature).toBe(60);
    expect(next.temperatures.heaterChamber!.temperature).toBe(45);
    expect(next.temperatures.dryingChamber1!.temperature).toBe(55);
    expect(next.temperatures.dryingChamber2!.temperature).toBe(56);
    expect(next.temperatures.dryingChamber3!.temperature).toBe(57);
    expect(next.temperatures.dryingChamber4!.temperature).toBe(58);
    expect(next.temperatures.bedGlass!.temperature).toBe(59);
  });

  test('preserves heaters absent from the update', () => {
    const prev = baseStatus();
    prev.temperatures = {
      ...prev.temperatures,
      heaterBed: {temperature: 60, target: 60, power: 0.4},
    };
    const next = mergeStatusUpdate(prev, {extruder: {temperature: 210}});
    expect(next.temperatures.heaterBed).toEqual({temperature: 60, target: 60, power: 0.4});
  });

  test('merges heater fields without mutating prev', () => {
    const prev = baseStatus();
    prev.temperatures = {
      ...prev.temperatures,
      extruder: {temperature: 25, target: 0, power: 0},
    };
    const next = mergeStatusUpdate(prev, {
      extruder: {target: 215},
      heater_bed: {temperature: 60},
    });
    expect(next.temperatures.extruder).toEqual({temperature: 25, target: 215, power: 0});
    expect(prev.temperatures.extruder).toEqual({temperature: 25, target: 0, power: 0});
    expect(prev.temperatures.heaterBed).toBeNull();
  });
});
