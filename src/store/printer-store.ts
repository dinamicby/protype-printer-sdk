import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import type { PrinterStatus } from '../api/types';
import { reconcileStatus } from './reconcile';

export interface PrinterStoreState {
  status: PrinterStatus | null;
  isConnected: boolean;
  wsConnected: boolean;
  error: string | null;
  applyStatus: (next: PrinterStatus) => void;
  setConnection: (patch: Partial<Pick<PrinterStoreState, 'isConnected' | 'wsConnected' | 'error'>>) => void;
}

export function createPrinterStore() {
  return createStore<PrinterStoreState>()(
    subscribeWithSelector((set, get) => ({
      status: null,
      isConnected: false,
      wsConnected: false,
      error: null,
      applyStatus: (next) => {
        const reconciled = reconcileStatus(get().status, next);
        if (reconciled !== get().status) set({ status: reconciled });
      },
      setConnection: (patch) => {
        const cur = get();
        const dirty = (Object.keys(patch) as (keyof typeof patch)[])
          .some((k) => !Object.is(cur[k], patch[k]));
        if (dirty) set(patch);
      },
    })),
  );
}

export type PrinterStore = ReturnType<typeof createPrinterStore>;
