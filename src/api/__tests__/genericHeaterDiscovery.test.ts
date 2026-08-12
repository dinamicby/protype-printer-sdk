/**
 * The status poll has to find chambers and dryers under whatever names THIS
 * printer's config uses. It used to query one vendor's spelling
 * (`Active_Chamber`, `Drying_Chamber_N`); Moonraker answers such a query with
 * `{}` for every object it does not have, so on a QIDI the chamber and the dry
 * box silently disappeared instead of erroring — two cards short of the desktop.
 */
import { describe, expect, test, vi, afterEach } from 'vitest';
import { MoonrakerClient } from '../moonraker-client';

afterEach(() => vi.unstubAllGlobals());

/** The live `qidi-max4` object list, trimmed to what discovery looks at. */
const QIDI_OBJECTS = [
  'webhooks',
  'configfile',
  'extruder',
  'heater_bed',
  'heater_generic chamber',
  'heater_generic heater_box1',
  'temperature_sensor Chamber_Thermal_Protection_Sensor',
  'fan',
];

const QIDI_STATUS = {
  extruder: { temperature: 210.25, target: 210, power: 0.28 },
  heater_bed: { temperature: 55.06, target: 55, power: 0.005 },
  'heater_generic chamber': { temperature: 33.79, target: 0, power: 0 },
  'heater_generic heater_box1': { temperature: 33.02, target: 0, power: 0 },
};

function client() {
  return new MoonrakerClient({ baseUrl: 'http://x', mode: 'local', timeout: 500, maxRetries: 1 });
}

/**
 * Stub Moonraker: objects.list answers `objects`, everything else answers the
 * status body. Records every requested URL so the query itself can be asserted.
 */
function stubMoonraker(objects: string[] | null, status: Record<string, any> = QIDI_STATUS) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(url);
      const body = url.includes('/printer/objects/list')
        ? { result: objects === null ? {} : { objects } }
        : { result: { status } };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
  return urls;
}

describe('generic heater discovery in the status poll', () => {
  test('queries the heaters this printer actually has', async () => {
    const urls = stubMoonraker(QIDI_OBJECTS);
    await client().getPrinterStatus();

    const query = decodeURIComponent(urls.find((u) => u.includes('objects/query')) ?? '');
    expect(query).toContain('heater_generic chamber');
    expect(query).toContain('heater_generic heater_box1');
  });

  test('fills the chamber and dryer slots from the discovered names', async () => {
    stubMoonraker(QIDI_OBJECTS);
    const res = await client().getPrinterStatus();

    expect(res.success).toBe(true);
    expect(res.data!.temperatures.heaterChamber).toMatchObject({ temperature: 33.79 });
    expect(res.data!.temperatures.dryingChamber1).toMatchObject({ temperature: 33.02 });
  });

  test('exposes every generic heater under its real Klipper name', async () => {
    stubMoonraker(QIDI_OBJECTS);
    const res = await client().getPrinterStatus();

    expect(res.data!.temperatures.genericHeaters.map((h) => h.name)).toEqual([
      'heater_generic chamber',
      'heater_generic heater_box1',
    ]);
  });

  test('discovers once and reuses it — the poll runs every few seconds', async () => {
    const urls = stubMoonraker(QIDI_OBJECTS);
    const c = client();
    await c.getPrinterStatus();
    await c.getPrinterStatus();

    expect(urls.filter((u) => u.includes('objects/list'))).toHaveLength(1);
  });

  test('falls back to the CD400 names when objects.list gives nothing', async () => {
    // No list → the printer still has to report the heaters we know how to name.
    const urls = stubMoonraker(null);
    await client().getPrinterStatus();

    const query = decodeURIComponent(urls.find((u) => u.includes('objects/query')) ?? '');
    expect(query).toContain('heater_generic Active_Chamber');
    expect(query).toContain('heater_generic Drying_Chamber_1');
  });

  test('leaves the slots null on a printer with no generic heaters', async () => {
    stubMoonraker(['extruder', 'heater_bed'], {
      extruder: { temperature: 200, target: 200, power: 1 },
      heater_bed: { temperature: 60, target: 60, power: 1 },
    });
    const res = await client().getPrinterStatus();

    expect(res.data!.temperatures.heaterChamber).toBeNull();
    expect(res.data!.temperatures.dryingChamber1).toBeNull();
    expect(res.data!.temperatures.genericHeaters).toEqual([]);
  });
});

describe('setGenericHeaterTemp', () => {
  test('addresses the heater by its bare config name', async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        bodies.push(String(init?.body ?? ''));
        return Promise.resolve(new Response(JSON.stringify({ result: 'ok' }), { status: 200 }));
      }),
    );

    await client().setGenericHeaterTemp('heater_box1', 60);

    expect(bodies[0]).toContain('SET_HEATER_TEMPERATURE HEATER=heater_box1 TARGET=60');
  });
});
