import { describe, expect, test } from 'vitest';
import { reconcileStatus } from './reconcile';
import type { PrinterStatus } from '../api/types';

function sample(over: Partial<PrinterStatus> = {}): PrinterStatus {
  return {
    klipperState: 'ready',
    printStats: { state: 'printing', filename: 'a.gcode', totalDuration: 10, printDuration: 9, filamentUsed: 1, message: '', info: { totalLayer: 100, currentLayer: 5 } },
    virtualSdCard: { progress: 0.5, isActive: true, filePosition: 100 },
    displayStatus: { progress: 0.5, message: '' },
    gcodeMove: { speedFactor: 1, extrudeFactor: 1, speed: 100 },
    temperatures: { extruder: { temperature: 245, target: 245, power: 0.4 } } as PrinterStatus['temperatures'],
    toolhead: { position: { x: 0, y: 0, z: 0, e: 0 } } as PrinterStatus['toolhead'],
    fan: { speed: 0.5, rpm: null },
    filamentSensors: [],
    progress: 0.5,
    elapsedSeconds: 9,
    eta: new Date(1_000_000),
    isConnected: true,
    ...over,
  } as PrinterStatus;
}

describe('reconcileStatus', () => {
  test('identical payload returns the SAME reference', () => {
    const prev = sample();
    const next = sample({ eta: new Date(1_000_500) }); // eta в допуске 2с
    expect(reconcileStatus(prev, next)).toBe(prev);
  });

  test('changed temperature produces new object but keeps untouched slice refs', () => {
    const prev = sample();
    const next = sample({
      temperatures: { extruder: { temperature: 246, target: 245, power: 0.5 } } as PrinterStatus['temperatures'],
      eta: new Date(1_000_100),
    });
    const out = reconcileStatus(prev, next);
    expect(out).not.toBe(prev);
    expect(out.temperatures).toBe(next.temperatures); // изменившийся срез — новый
    expect(out.printStats).toBe(prev.printStats);     // неизменившийся — старая ссылка
    expect(out.toolhead).toBe(prev.toolhead);
  });

  test('eta drift beyond tolerance counts as change', () => {
    const prev = sample();
    const next = sample({ eta: new Date(1_005_000) }); // +5с
    expect(reconcileStatus(prev, next)).not.toBe(prev);
  });

  test('null prev returns next as-is', () => {
    const next = sample();
    expect(reconcileStatus(null, next)).toBe(next);
  });
});
