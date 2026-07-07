import {describe, test, expect} from 'vitest';
import {parseSaveVariables} from '../moonraker-client';

describe('parseSaveVariables', () => {
  test('extracts variables map from save_variables object', () => {
    const obj = {save_variables: {variables: {loaded_1: 1, preloaded_2: 0, actual_spool_1: 2}}};
    expect(parseSaveVariables(obj)).toEqual({loaded_1: 1, preloaded_2: 0, actual_spool_1: 2});
  });

  test('returns empty object when save_variables missing', () => {
    expect(parseSaveVariables({})).toEqual({});
  });

  test('returns empty object when variables missing', () => {
    expect(parseSaveVariables({save_variables: {}})).toEqual({});
  });
});
