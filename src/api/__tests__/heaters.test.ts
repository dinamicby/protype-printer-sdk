import { describe, test, expect } from 'vitest';
import {
  isGenericHeaterKey,
  discoverGenericHeaterObjects,
  classifyGenericHeater,
  parseGenericHeaters,
  genericHeaterSlots,
  genericHeaterName,
  genericHeaterForSlot,
  genericHeaterSlotNames,
} from '../heaters';

describe('isGenericHeaterKey', () => {
  test('accepts heater_generic objects', () => {
    expect(isGenericHeaterKey('heater_generic Active_Chamber')).toBe(true);
    expect(isGenericHeaterKey('heater_generic chamber')).toBe(true);
  });

  test('rejects the built-in heaters and read-only sensors', () => {
    expect(isGenericHeaterKey('heater_bed')).toBe(false);
    expect(isGenericHeaterKey('extruder')).toBe(false);
    expect(isGenericHeaterKey('temperature_sensor chamber')).toBe(false);
    expect(isGenericHeaterKey('temperature_fan chamber')).toBe(false);
    expect(isGenericHeaterKey('heater_generic')).toBe(false);
  });
});

describe('discoverGenericHeaterObjects', () => {
  test('picks only heater_generic names from an objects.list result', () => {
    const names = [
      'extruder',
      'heater_bed',
      'heater_generic chamber',
      'temperature_sensor mcu',
      'heater_generic Drying_Chamber_1',
    ];
    expect(discoverGenericHeaterObjects(names)).toEqual([
      'heater_generic chamber',
      'heater_generic Drying_Chamber_1',
    ]);
  });
});

describe('classifyGenericHeater', () => {
  test('recognises a chamber heater under either vendor spelling', () => {
    // Protype CD400 spelling and the bare QIDI one.
    expect(classifyGenericHeater('Active_Chamber')).toBe('chamber');
    expect(classifyGenericHeater('chamber')).toBe('chamber');
    expect(classifyGenericHeater('heater_chamber')).toBe('chamber');
    expect(classifyGenericHeater('enclosure')).toBe('chamber');
  });

  test('classifies a drying chamber as a dryer, not a chamber', () => {
    // "Drying_Chamber_1" contains BOTH tokens — dryer has to win, or every
    // dryer lands in the single chamber slot and hides the real chamber.
    expect(classifyGenericHeater('Drying_Chamber_1')).toBe('dryer');
    expect(classifyGenericHeater('Filament_Dryer')).toBe('dryer');
    expect(classifyGenericHeater('dryer')).toBe('dryer');
    expect(classifyGenericHeater('dry_box')).toBe('dryer');
  });

  test('classifies a QIDI dry box as a dryer', () => {
    // Verified on the office QIDI X-Max 4 (`qidi-max4`): the heater is
    // `heater_generic heater_box1`, and the same firmware exposes a
    // `prepare_filament_dry` macro and per-material `box_min_temp/box_max_temp`.
    expect(classifyGenericHeater('heater_box1')).toBe('dryer');
  });

  test('falls back to "other" for a heater it cannot name', () => {
    expect(classifyGenericHeater('my_custom_heater')).toBe('other');
  });
});

describe('parseGenericHeaters', () => {
  test('parses a generic heater into name, label, kind and readings', () => {
    const out = parseGenericHeaters({
      'heater_generic chamber': { temperature: 41.5, target: 50, power: 0.8 },
    });
    expect(out).toEqual([
      {
        name: 'heater_generic chamber',
        label: 'chamber',
        kind: 'chamber',
        temperature: 41.5,
        target: 50,
        power: 0.8,
      },
    ]);
  });

  test('ignores non-heater keys and objects with no temperature', () => {
    // A queried-but-absent object comes back as `{}` — Moonraker answers the
    // whole query rather than failing it, which is exactly how the CD400 names
    // used to vanish silently on a printer that spells them differently.
    const out = parseGenericHeaters({
      heater_bed: { temperature: 60 },
      'temperature_sensor chamber': { temperature: 30 },
      'heater_generic Active_Chamber': {},
    });
    expect(out).toEqual([]);
  });

  test('defaults missing target and power to 0', () => {
    const out = parseGenericHeaters({
      'heater_generic chamber': { temperature: 25 },
    });
    expect(out[0]).toMatchObject({ target: 0, power: 0 });
  });
});

describe('genericHeaterSlots', () => {
  test('maps a QIDI chamber and dry box onto the panel slots', () => {
    // The live `qidi-max4` layout: two cards the app used to miss entirely.
    const slots = genericHeaterSlots(
      parseGenericHeaters({
        'heater_generic chamber': { temperature: 33.79, target: 0, power: 0 },
        'heater_generic heater_box1': { temperature: 33.02, target: 0, power: 0 },
      }),
    );
    expect(slots.heaterChamber).toMatchObject({ temperature: 33.79 });
    expect(slots.dryingChamber1).toMatchObject({ temperature: 33.02 });
    expect(slots.dryingChamber2).toBeNull();
  });

  test('orders dryers numerically regardless of discovery order', () => {
    const slots = genericHeaterSlots(
      parseGenericHeaters({
        'heater_generic Drying_Chamber_2': { temperature: 2 },
        'heater_generic Drying_Chamber_1': { temperature: 1 },
      }),
    );
    expect(slots.dryingChamber1?.temperature).toBe(1);
    expect(slots.dryingChamber2?.temperature).toBe(2);
  });

  test('leaves every slot null when the printer has no generic heaters', () => {
    expect(genericHeaterSlots([])).toEqual({
      heaterChamber: null,
      dryingChamber1: null,
      dryingChamber2: null,
    });
  });

  test('never puts an unrecognised heater in the chamber slot', () => {
    const slots = genericHeaterSlots(
      parseGenericHeaters({ 'heater_generic my_custom_heater': { temperature: 70 } }),
    );
    expect(slots.heaterChamber).toBeNull();
  });
});

describe('genericHeaterName', () => {
  const HEATERS = parseGenericHeaters({
    'heater_generic chamber': { temperature: 41 },
    'heater_generic Drying_Chamber_2': { temperature: 2 },
    'heater_generic Drying_Chamber_1': { temperature: 1 },
  });

  test('gives the bare name SET_HEATER_TEMPERATURE expects', () => {
    expect(genericHeaterName(HEATERS, 'heaterChamber')).toBe('chamber');
  });

  test('resolves the same heater the slot displays', () => {
    // Read and write must agree, or the panel shows dryer 1 and the command
    // heats dryer 2.
    expect(genericHeaterName(HEATERS, 'dryingChamber1')).toBe('Drying_Chamber_1');
    expect(genericHeaterName(HEATERS, 'dryingChamber2')).toBe('Drying_Chamber_2');
  });

  test('returns null when the printer has no such heater', () => {
    expect(genericHeaterName([], 'heaterChamber')).toBeNull();
  });
});

describe('genericHeaterForSlot', () => {
  const HEATERS = parseGenericHeaters({
    'heater_generic chamber': { temperature: 41 },
    'heater_generic Filament_Dryer': { temperature: 55 },
  });

  test('gives the full Klipper object key the temperature store is keyed by', () => {
    expect(genericHeaterForSlot(HEATERS, 'heaterChamber')?.name).toBe('heater_generic chamber');
    expect(genericHeaterForSlot(HEATERS, 'dryingChamber1')?.name).toBe(
      'heater_generic Filament_Dryer',
    );
  });

  test('returns null for a slot this printer does not fill', () => {
    expect(genericHeaterForSlot(HEATERS, 'dryingChamber2')).toBeNull();
  });
});

describe('genericHeaterSlotNames', () => {
  test('picks slots from bare object names alone', () => {
    // objects.list carries no readings, so slots have to be resolvable from
    // names only — that is what the WS subscription is built from.
    expect(
      genericHeaterSlotNames([
        'extruder',
        'heater_bed',
        'heater_generic chamber',
        'heater_generic Filament_Dryer',
      ]),
    ).toEqual({
      heaterChamber: 'heater_generic chamber',
      dryingChamber1: 'heater_generic Filament_Dryer',
      dryingChamber2: null,
    });
  });

  test('agrees with the CD400 layout', () => {
    expect(
      genericHeaterSlotNames([
        'heater_generic Drying_Chamber_2',
        'heater_generic Active_Chamber',
        'heater_generic Drying_Chamber_1',
      ]),
    ).toEqual({
      heaterChamber: 'heater_generic Active_Chamber',
      dryingChamber1: 'heater_generic Drying_Chamber_1',
      dryingChamber2: 'heater_generic Drying_Chamber_2',
    });
  });
});
