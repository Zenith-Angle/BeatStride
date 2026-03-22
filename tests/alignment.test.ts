import { describe, expect, test } from 'vitest';
import { alignMetronomeToDownbeat } from '../src/shared/services/alignmentService';

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
    expect(result.downbeatOffsetMsAfterSpeed).toBe(200);
    expect(result.metronomeStartMs).toBe(220);
  });
});
