import { describe, expect, test } from 'vitest';
import { analyzeTempoFromSamples } from '../src/main/services/tempoDetectionService';

const SAMPLE_RATE = 22050;

function createPulseTrain(options: {
  durationSec: number;
  bpm: number;
  firstBeatMs: number;
  beatsPerBar?: number;
  accentPattern?: number[];
}): Int16Array {
  const totalSamples = Math.round(options.durationSec * SAMPLE_RATE);
  const samples = new Int16Array(totalSamples);
  const beatIntervalSamples = Math.round((60 / options.bpm) * SAMPLE_RATE);
  const firstBeatSamples = Math.round((options.firstBeatMs / 1000) * SAMPLE_RATE);
  const safeBeatsPerBar = Math.max(1, options.beatsPerBar ?? 4);
  const accentPattern =
    options.accentPattern && options.accentPattern.length === safeBeatsPerBar
      ? options.accentPattern
      : Array.from({ length: safeBeatsPerBar }, (_, index) => (index === 0 ? 1.6 : 1));

  for (
    let beatIndex = 0, start = firstBeatSamples;
    start < totalSamples;
    beatIndex += 1, start += beatIntervalSamples
  ) {
    const amplitude = Math.round(18000 * (accentPattern[beatIndex % safeBeatsPerBar] ?? 1));
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
      beatsPerBar: 4,
      accentPattern: [1, 1, 1.7, 1]
    });

    const result = analyzeTempoFromSamples(samples);

    expect(result.bpm).toBeGreaterThanOrEqual(114);
    expect(result.bpm).toBeLessThanOrEqual(126);
    expect(result.firstBeatMs).toBeGreaterThanOrEqual(150);
    expect(result.firstBeatMs).toBeLessThanOrEqual(350);
    expect(result.downbeatOffsetMs).toBeGreaterThanOrEqual(1050);
    expect(result.downbeatOffsetMs).toBeLessThanOrEqual(1450);
    expect(result.timeSignature).toBe('4/4');
  });

  test('detects 3/4 meter from accent pattern', () => {
    const samples = createPulseTrain({
      durationSec: 12,
      bpm: 132,
      firstBeatMs: 120,
      beatsPerBar: 3,
      accentPattern: [1.8, 1, 1]
    });

    const result = analyzeTempoFromSamples(samples);

    expect(result.timeSignature).toBe('3/4');
    expect(result.beatsPerBar).toBe(3);
    expect(result.meterConfidence).toBeGreaterThan(0);
  });

  test('detects 6/8 meter with secondary accent', () => {
    const samples = createPulseTrain({
      durationSec: 14,
      bpm: 126,
      firstBeatMs: 160,
      beatsPerBar: 6,
      accentPattern: [1.8, 1, 1, 1.35, 1, 1]
    });

    const result = analyzeTempoFromSamples(samples);

    expect(result.timeSignature).toBe('6/8');
    expect(result.beatsPerBar).toBe(6);
    expect(result.accentPattern).toEqual([1.35, 1, 1, 1.15, 1, 1]);
  });
});
