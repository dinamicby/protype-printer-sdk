import {mergeStatusUpdate} from '../MoonrakerProvider';
import type {PrinterStatus} from '../../api/types';

function baseStatus(): PrinterStatus {
  return {
    klipperState: 'ready',
    printStats: {state: 'standby', filename: '', totalDuration: 0, printDuration: 0, filamentUsed: 0, message: '', info: {totalLayer: null, currentLayer: null}},
    temperatures: {extruder: null, extruder1: null, heaterBed: null, heaterChamber: null, dryingChamber1: null, dryingChamber2: null, bedGlass: null},
    toolhead: {position: {x: 0, y: 0, z: 0, e: 0}, homed: [false, false, false], maxVelocity: 0, maxAccel: 0, printTime: 0, estimatedPrintTime: 0, activeExtruder: 'extruder', axisMinimum: null, axisMaximum: null},
    virtualSdCard: {filePath: '', progress: 0, isActive: false, filePosition: 0, fileSize: 0},
    filamentSensors: [{name: 'FS9', enabled: true, filamentDetected: false}],
    saveVariables: {loaded_1: 0},
    bedMesh: null,
    progress: 0,
    eta: null,
    elapsedSeconds: 0,
    isConnected: true,
  } as PrinterStatus;
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
