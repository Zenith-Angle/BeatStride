import { describe, expect, test } from 'vitest';
import { generateBeatTimes } from '../src/shared/services/beatGridService';

describe('generateBeatTimes', () => {
  test('generates beat ticks from offset', () => {
    const beats = generateBeatTimes(2000, 120, 0);
    expect(beats).toEqual([0, 500, 1000, 1500, 2000]);
  });

  test('supports negative offset and clamps to timeline', () => {
    const beats = generateBeatTimes(1200, 120, -250);
    expect(beats[0]).toBe(250);
  });
});
