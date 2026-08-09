import { describe, expect, it } from 'vitest';
import { parseObjectsList, parseConfigSettings } from '../objects';

describe('parseObjectsList', () => {
  it('отдаёт имена секций как есть', () => {
    expect(parseObjectsList({ objects: ['bed_mesh', 'gcode_macro CHOOSE_SPOOL_1'] }))
      .toEqual(['bed_mesh', 'gcode_macro CHOOSE_SPOOL_1']);
  });

  it('не-строки отбрасывает, а не роняет разбор', () => {
    expect(parseObjectsList({ objects: ['extruder', 42, null] })).toEqual(['extruder']);
  });

  it('пустой или чужой ответ — пустой список', () => {
    expect(parseObjectsList(null)).toEqual([]);
    expect(parseObjectsList({})).toEqual([]);
  });
});

describe('parseConfigSettings', () => {
  it('достаёт settings из конверта status.configfile', () => {
    const raw = { status: { configfile: { settings: { 'gcode_macro choose_spool_1': { gcode: 'X' } } } } };

    expect(parseConfigSettings(raw)).toEqual({ 'gcode_macro choose_spool_1': { gcode: 'X' } });
  });

  it('отсутствующий configfile — пустой объект, а не undefined', () => {
    expect(parseConfigSettings({ status: {} })).toEqual({});
    expect(parseConfigSettings(null)).toEqual({});
  });
});
