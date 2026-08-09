import { describe, expect, test } from 'vitest';
import { parseObjectsList, parseConfigSettings } from '../objects';

describe('parseObjectsList', () => {
  test('отдаёт имена секций как есть', () => {
    expect(parseObjectsList({ objects: ['bed_mesh', 'gcode_macro CHOOSE_SPOOL_1'] }))
      .toEqual(['bed_mesh', 'gcode_macro CHOOSE_SPOOL_1']);
  });

  test('не-строки отбрасывает, а не роняет разбор', () => {
    expect(parseObjectsList({ objects: ['extruder', 42, null] })).toEqual(['extruder']);
  });

  test('пустой или чужой ответ — пустой список', () => {
    expect(parseObjectsList(null)).toEqual([]);
    expect(parseObjectsList({})).toEqual([]);
  });
});

describe('parseConfigSettings', () => {
  test('достаёт settings из конверта status.configfile', () => {
    const raw = { status: { configfile: { settings: { 'gcode_macro choose_spool_1': { gcode: 'X' } } } } };

    expect(parseConfigSettings(raw)).toEqual({ 'gcode_macro choose_spool_1': { gcode: 'X' } });
  });

  test('отсутствующий configfile — пустой объект, а не undefined', () => {
    expect(parseConfigSettings({ status: {} })).toEqual({});
    expect(parseConfigSettings(null)).toEqual({});
  });
});
