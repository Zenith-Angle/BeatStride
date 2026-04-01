import { describe, expect, test } from 'vitest';
import { analyzeTempoFromSamples } from '../src/main/services/tempoDetectionService';

const SAMPLE_RATE = 22050;

function createPulseTrain(options: {
  durationSec: number;
  bpm: number;
  firstBeatMs: number;
  accentPhase?: number;
  beatsPerBar?: number;
}): Int16Array {
  const totalSamples = Math.round(options.durationSec * SAMPLE_RATE);
  const samples = new Int16Array(totalSamples);
  const beatIntervalSamples = Math.round((60 / options.bpm) * SAMPLE_RATE);
  const firstBeatSamples = Math.round((options.firstBeatMs / 1000) * SAMPLE_RATE);
  const safeBeatsPerBar = Math.max(1, options.beatsPerBar ?? 4);
  const accentPhase = options.accentPhase ?? 0;

  for (
    let beatIndex = 0, start = firstBeatSamples;
    start < totalSamples;
    beatIndex += 1, start += beatIntervalSamples
  ) {
    const amplitude = beatIndex % safeBeatsPerBar === accentPhase ? 30000 : 18000;
    const width = Math.min(220, totalSamples - start);
    for (let offset = 0; offset < width; offset += 1) {
      samples[start + offset] = amplitude;
    }
  }

  return samples;
}

describe('analyzeTempoFromSamples', () => {
  test('estimates bpm and downbeat offset from a pulse train', () => {
    const samples = createPulseTrain({
      durationSec: 12,
      bpm: 120,
      firstBeatMs: 250,
      accentPhase: 2,
      beatsPerBar: 4
    });

    const result = analyzeTempoFromSamples(samples, 4);

    expect(result.bpm).toBeGreaterThanOrEqual(114);
    expect(result.bpm).toBeLessThanOrEqual(126);
    expect(result.firstBeatMs).toBeGreaterThanOrEqual(150);
    expect(result.firstBeatMs).toBeLessThanOrEqual(350);
    expect(result.downbeatOffsetMs).toBeGreaterThanOrEqual(1050);
    expect(result.downbeatOffsetMs).toBeLessThanOrEqual(1450);
  });
});
