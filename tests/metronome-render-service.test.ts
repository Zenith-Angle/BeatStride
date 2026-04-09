import { describe, expect, test } from 'vitest';
import { buildMetronomeRenderCacheKeyInput } from '../src/shared/services/metronomeRenderService';

const baseSource = {
  metronomeSamplePath: 'C:/metronome/click.wav',
  renderOptions: {
    beatGainDb: -2,
    beatOriginalBpm: 180,
    beatRenderMode: 'sampled-click' as const
  },
  track: {
    processedDurationMs: 120000,
    beatTimesMs: [0, 333, 666, 999],
    accentPattern: [1.35, 1, 1, 1],
    metronomeBpm: 180
  }
};

describe('buildMetronomeRenderCacheKeyInput', () => {
  test('keeps stable normalized spec for cache signatures', () => {
    const spec = buildMetronomeRenderCacheKeyInput(baseSource);

    expect('outputPath' in spec).toBe(false);
    expect(spec.durationMs).toBe(120000);
    expect(spec.sampleRate).toBe(48000);
    expect(spec.channels).toBe(2);
  });

  test('changes when metronome render settings change', () => {
    const baseline = JSON.stringify(buildMetronomeRenderCacheKeyInput(baseSource));
    const changedMode = JSON.stringify(
      buildMetronomeRenderCacheKeyInput({
        ...baseSource,
        renderOptions: {
          ...baseSource.renderOptions,
          beatRenderMode: 'stretched-file'
        }
      })
    );
    const changedBpm = JSON.stringify(
      buildMetronomeRenderCacheKeyInput({
        ...baseSource,
        renderOptions: {
          ...baseSource.renderOptions,
          beatOriginalBpm: 150
        }
      })
    );
    const changedTarget = JSON.stringify(
      buildMetronomeRenderCacheKeyInput({
        ...baseSource,
        track: {
          ...baseSource.track,
          metronomeBpm: 172
        }
      })
    );
    const changedAccent = JSON.stringify(
      buildMetronomeRenderCacheKeyInput({
        ...baseSource,
        track: {
          ...baseSource.track,
          accentPattern: [1.5, 1, 1, 1]
        }
      })
    );
    const changedGain = JSON.stringify(
      buildMetronomeRenderCacheKeyInput({
        ...baseSource,
        renderOptions: {
          ...baseSource.renderOptions,
          beatGainDb: 3
        }
      })
    );

    expect(changedMode).not.toBe(baseline);
    expect(changedBpm).not.toBe(baseline);
    expect(changedTarget).not.toBe(baseline);
    expect(changedAccent).not.toBe(baseline);
    expect(changedGain).not.toBe(baseline);
  });
});
