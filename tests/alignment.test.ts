import { describe, expect, test } from 'vitest';
import {
  alignMetronomeToDownbeat,
  resolveAlignedTargetBpm,
  resolveHarmonicMultiplier
} from '../src/shared/services/alignmentService';

describe('alignMetronomeToDownbeat', () => {
  test('aligns metronome start after speed transformation', () => {
    const result = alignMetronomeToDownbeat(
      {
        sourceBpm: 120,
        targetBpm: 180,
        detectedBpm: undefined,
        downbeatOffsetMs: 300,
        metronomeOffsetMs: 20
      },
      { globalTargetBpm: 180 }
    );
    expect(result.speedRatio).toBe(1.5);
    expect(result.effectiveSourceBpm).toBe(120);
    expect(result.downbeatOffsetMsAfterSpeed).toBe(200);
    expect(result.metronomeStartMs).toBe(220);
  });

  test('maps half-time sources into target grid when enabled', () => {
    const result = alignMetronomeToDownbeat(
      {
        sourceBpm: 90,
        targetBpm: undefined,
        detectedBpm: undefined,
        downbeatOffsetMs: 0,
        metronomeOffsetMs: 0
      },
      {
        globalTargetBpm: 180,
        harmonicTolerance: 0.12,
        harmonicMappingEnabled: true,
        halfMapUpperBpm: 110
      }
    );

    expect(result.effectiveSourceBpm).toBe(180);
    expect(result.speedRatio).toBe(1);
  });

  test('uses a comfort target around 120 bpm for tracks near 110 when no manual target is set', () => {
    const result = alignMetronomeToDownbeat(
      {
        sourceBpm: 110,
        targetBpm: undefined,
        detectedBpm: undefined,
        downbeatOffsetMs: 0,
        metronomeOffsetMs: 0
      },
      {
        globalTargetBpm: 180,
        harmonicTolerance: 0.12,
        harmonicMappingEnabled: true,
        halfMapUpperBpm: 110
      }
    );

    expect(result.targetBpm).toBe(120);
    expect(result.effectiveSourceBpm).toBe(110);
    expect(result.speedRatio).toBeCloseTo(120 / 110, 6);
  });
});

describe('resolveHarmonicMultiplier', () => {
  test('returns direct mode when mapping is disabled', () => {
    expect(resolveHarmonicMultiplier(90, 180, 0.12, true, 110)).toEqual({
      multiplier: 1,
      mode: 'direct'
    });
  });

  test('does not force half-time range mapping for sources at or above 100 bpm', () => {
    expect(resolveHarmonicMultiplier(100, 180, 0.12, false, 110)).toEqual({
      multiplier: 1,
      mode: 'direct'
    });
  });
});

describe('resolveAlignedTargetBpm', () => {
  test('prefers 120 bpm as comfort target for 100-125 bpm sources when global target is high', () => {
    expect(resolveAlignedTargetBpm(110, undefined, 180)).toEqual({
      targetBpm: 120,
      mode: 'comfort-target->120'
    });
  });
});
