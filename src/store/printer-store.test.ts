import { describe, expect, test, vi } from 'vitest';
import { createPrinterStore } from './printer-store';
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

describe('createPrinterStore', () => {
  test('applyStatus with an unchanged payload does not notify subscribers', () => {
    const store = createPrinterStore();
    store.getState().applyStatus(sample());

    const listener = vi.fn();
    store.subscribe((state) => state.status, listener);

    // Identical clone (new object references, same data) — must be a no-op.
    store.getState().applyStatus(sample());
    expect(listener).not.toHaveBeenCalled();

    // Now a real change — must notify exactly once.
    store.getState().applyStatus(sample({ progress: 0.75 }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('setConnection only notifies when a patched field actually changes', () => {
    const store = createPrinterStore();
    const listener = vi.fn();
    store.subscribe((state) => state.isConnected, listener);

    store.getState().setConnection({ isConnected: false });
    expect(listener).not.toHaveBeenCalled();

    store.getState().setConnection({ isConnected: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
