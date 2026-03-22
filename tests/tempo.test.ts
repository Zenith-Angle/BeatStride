import { describe, expect, test } from 'vitest';
import { computeSpeedRatio, splitAtempoChain } from '../src/shared/utils/tempo';

describe('computeSpeedRatio', () => {
  test('computes ratio from source to target bpm', () => {
    expect(computeSpeedRatio(90, 180)).toBe(2);
    expect(computeSpeedRatio(200, 180)).toBe(0.9);
  });
});

describe('splitAtempoChain', () => {
  test('splits ratio greater than 2', () => {
    expect(splitAtempoChain(4)).toEqual([2, 2]);
  });

  test('splits ratio lower than 0.5', () => {
    expect(splitAtempoChain(0.25)).toEqual([0.5, 0.5]);
  });

  test('returns single stage for stable range', () => {
    expect(splitAtempoChain(1.5)).toEqual([1.5]);
  });
});
