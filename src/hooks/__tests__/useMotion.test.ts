import {describe, test, expect} from 'vitest';
import {computeIsHomed} from '../useMotion';

describe('computeIsHomed', () => {
  test('returns true when all three axes are homed', () => {
    expect(computeIsHomed([true, true, true])).toBe(true);
  });

  test('returns false when any axis is not homed', () => {
    expect(computeIsHomed([true, true, false])).toBe(false);
    expect(computeIsHomed([false, true, true])).toBe(false);
    expect(computeIsHomed([true, false, true])).toBe(false);
  });

  test('returns false when no axes are homed', () => {
    expect(computeIsHomed([false, false, false])).toBe(false);
  });

  test('returns false when homed is undefined (toolhead not yet loaded)', () => {
    expect(computeIsHomed(undefined)).toBe(false);
  });

  test('returns false when homed array has unexpected length', () => {
    expect(computeIsHomed([])).toBe(false);
    expect(computeIsHomed([true, true])).toBe(false);
  });
});
