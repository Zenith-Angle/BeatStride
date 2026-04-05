import { spawn } from 'node:child_process';
import type { TimeSignature, TrackAnalysisResult } from '@shared/types';
import { getDefaultMeterMetadata } from '@shared/services/meterService';

const SAMPLE_RATE = 22050;
const CHANNELS = 1;
const FRAME_SIZE = 1024;
const HOP_SIZE = 512;
const MIN_BPM = 70;
const MAX_BPM = 210;
const BPM_STEP = 0.5;
const SUPPORTED_METERS: TimeSignature[] = ['3/4', '4/4', '6/8'];

function frameIndexToMs(frameIndex: number): number {
  return Math.max(0, Math.round((frameIndex * HOP_SIZE * 1000) / SAMPLE_RATE));
}

async function decodeAudioToMonoPcm(
  ffmpegPath: string,
  filePath: string,
  analysisSeconds: number
): Promise<Int16Array> {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      filePath,
      '-vn',
      '-ac',
      String(CHANNELS),
      '-ar',
      String(SAMPLE_RATE),
      '-f',
      's16le'
    ];

    if (analysisSeconds > 0) {
      args.push('-t', String(analysisSeconds));
    }
    args.push('pipe:1');

    const child = spawn(ffmpegPath, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `ffmpeg exited with ${code}`));
        return;
      }
      const buffer = Buffer.concat(chunks);
      const samples = new Int16Array(
        buffer.buffer,
        buffer.byteOffset,
        Math.floor(buffer.byteLength / 2)
      );
      resolve(new Int16Array(samples));
    });
  });
}

function movingAverage(values: number[], radius: number): number[] {
  if (values.length === 0) {
    return [];
  }
  const out = new Array<number>(values.length).fill(0);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i] ?? 0;
    if (i > radius) {
      sum -= values[i - radius - 1] ?? 0;
    }
    const size = Math.min(i + 1, radius + 1);
    out[i] = sum / size;
  }
  return out;
}

function buildOnsetEnvelope(samples: Int16Array): number[] {
  if (samples.length < FRAME_SIZE) {
    return [];
  }

  const energies: number[] = [];
  for (let index = 0; index + FRAME_SIZE <= samples.length; index += HOP_SIZE) {
    let sum = 0;
    for (let i = 0; i < FRAME_SIZE; i += 1) {
      const value = samples[index + i] ?? 0;
      sum += value * value;
    }
    energies.push(Math.sqrt(sum / FRAME_SIZE));
  }

  const smoothed = movingAverage(energies, 3);
  const envelope = smoothed.map((value, index) => {
    const previous = index > 0 ? smoothed[index - 1] ?? value : value;
    return Math.max(0, value - previous);
  });
  const baseline = movingAverage(envelope, 12);
  const normalized = envelope.map((value, index) =>
    Math.max(0, value - (baseline[index] ?? 0) * 0.9)
  );
  const peak = Math.max(...normalized, 0);
  if (peak <= 0) {
    return normalized;
  }
  return normalized.map((value) => value / peak);
}

function sampleEnvelopePeak(
  envelope: number[],
  center: number,
  radius: number
): { index: number; value: number } {
  if (envelope.length === 0) {
    return { index: 0, value: 0 };
  }

  const anchor = Math.max(0, Math.min(envelope.length - 1, Math.round(center)));
  let bestIndex = anchor;
  let bestValue = envelope[anchor] ?? 0;
  const start = Math.max(0, anchor - radius);
  const end = Math.min(envelope.length - 1, anchor + radius);

  for (let index = start; index <= end; index += 1) {
    const value = envelope[index] ?? 0;
    if (value > bestValue) {
      bestValue = value;
      bestIndex = index;
    }
  }

  return {
    index: bestIndex,
    value: bestValue
  };
}

function estimateBeatFrames(envelope: number[], lagFrames: number): number[] {
  if (envelope.length === 0 || lagFrames <= 0) {
    return [];
  }

  const phaseSearchEnd = Math.max(0, Math.min(lagFrames - 1, envelope.length - 1));
  const phaseRadius = Math.max(1, Math.round(lagFrames * 0.12));
  let bestPhase = 0;
  let bestScore = -1;

  for (let phase = 0; phase <= phaseSearchEnd; phase += 1) {
    let score = 0;
    for (let frame = phase; frame < envelope.length; frame += lagFrames) {
      score += sampleEnvelopePeak(envelope, frame, phaseRadius).value;
    }
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }

  const frames: number[] = [];
  const snapRadius = Math.max(1, Math.round(lagFrames * 0.18));
  const minSpacing = Math.max(1, Math.round(lagFrames * 0.5));

  for (let frame = bestPhase; frame < envelope.length; frame += lagFrames) {
    const snapped = sampleEnvelopePeak(envelope, frame, snapRadius).index;
    if (frames.length === 0 || snapped - (frames.at(-1) ?? 0) >= minSpacing) {
      frames.push(snapped);
    }
  }

  return frames;
}

function scoreBpm(envelope: number[], lagFrames: number): number {
  if (lagFrames <= 0 || envelope.length <= lagFrames + 2) {
    return 0;
  }

  let score = 0;
  let weightedHits = 0;
  for (let i = 0; i + lagFrames < envelope.length; i += 1) {
    const current = envelope[i] ?? 0;
    const next = envelope[i + lagFrames] ?? 0;
    score += current * next;
    weightedHits += current;
  }

  if (lagFrames * 2 < envelope.length) {
    for (let i = 0; i + lagFrames * 2 < envelope.length; i += 1) {
      score += (envelope[i] ?? 0) * (envelope[i + lagFrames * 2] ?? 0) * 0.35;
    }
  }

  return weightedHits > 0 ? score / weightedHits : score;
}

function scoreMeterCandidate(
  beatFrames: number[],
  envelope: number[],
  signature: TimeSignature
): {
  score: number;
  downbeatFrame: number;
  accentPattern: number[];
  beatsPerBar: number;
  timeSignature: TimeSignature;
  primaryAlternation: number;
  secondaryLift: number;
} {
  const meter = getDefaultMeterMetadata(signature);
  if (beatFrames.length === 0) {
    return {
      score: 0,
      downbeatFrame: 0,
      accentPattern: meter.accentPattern,
      beatsPerBar: meter.beatsPerBar,
      timeSignature: signature,
      primaryAlternation: 0,
      secondaryLift: 0
    };
  }

  if (beatFrames.length < meter.beatsPerBar) {
    return {
      score: 0,
      downbeatFrame: beatFrames[0] ?? 0,
      accentPattern: meter.accentPattern,
      beatsPerBar: meter.beatsPerBar,
      timeSignature: signature,
      primaryAlternation: 0,
      secondaryLift: 0
    };
  }

  const beatStrengths = beatFrames.map((frame) => sampleEnvelopePeak(envelope, frame, 1).value);
  let bestPhase = 0;
  let bestScore = -1;
  const weightSum = meter.accentPattern.reduce((sum, value) => sum + value, 0);

  for (let phase = 0; phase < meter.beatsPerBar; phase += 1) {
    let weighted = 0;
    let total = 0;
    for (let index = 0; index < beatStrengths.length; index += 1) {
      const strength = beatStrengths[index] ?? 0;
      const relative = (index - phase + meter.beatsPerBar * 16) % meter.beatsPerBar;
      const weight = meter.accentPattern[relative] ?? 1;
      weighted += strength * weight;
      total += strength;
    }
    const normalized = total > 0 ? weighted / (total * Math.max(weightSum / meter.beatsPerBar, 1)) : 0;
    if (normalized > bestScore) {
      bestScore = normalized;
      bestPhase = phase;
    }
  }

  const laneValues = Array.from({ length: meter.beatsPerBar }, () => new Array<number>());
  for (let index = 0; index < beatStrengths.length; index += 1) {
    const relative = (index - bestPhase + meter.beatsPerBar * 16) % meter.beatsPerBar;
    laneValues[relative]?.push(beatStrengths[index] ?? 0);
  }

  const laneMeans = laneValues.map((values) => {
    if (values.length === 0) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  });

  const primaryValues = laneValues[0] ?? [];
  let primaryAlternation = 0;
  if (primaryValues.length >= 4) {
    const evenValues = primaryValues.filter((_, index) => index % 2 === 0);
    const oddValues = primaryValues.filter((_, index) => index % 2 === 1);
    const evenMean =
      evenValues.reduce((sum, value) => sum + value, 0) / Math.max(evenValues.length, 1);
    const oddMean =
      oddValues.reduce((sum, value) => sum + value, 0) / Math.max(oddValues.length, 1);
    const overallMean =
      primaryValues.reduce((sum, value) => sum + value, 0) / Math.max(primaryValues.length, 1);
    primaryAlternation =
      overallMean > 0 ? Math.abs(evenMean - oddMean) / overallMean : 0;
  }

  let secondaryLift = 0;
  if (signature === '6/8') {
    const secondaryMean = laneMeans[3] ?? 0;
    const weakIndices = laneMeans
      .map((value, index) => ({ value, index }))
      .filter(({ index }) => index !== 0 && index !== 3)
      .map(({ value }) => value);
    const weakMean =
      weakIndices.reduce((sum, value) => sum + value, 0) / Math.max(weakIndices.length, 1);
    const primaryMean = laneMeans[0] ?? 0;
    secondaryLift =
      primaryMean > 0 ? Math.max(0, (secondaryMean - weakMean) / primaryMean) : 0;
  }

  return {
    score: bestScore,
    downbeatFrame: beatFrames[bestPhase] ?? beatFrames[0] ?? 0,
    accentPattern: meter.accentPattern,
    beatsPerBar: meter.beatsPerBar,
    timeSignature: signature,
    primaryAlternation: Number(primaryAlternation.toFixed(3)),
    secondaryLift: Number(secondaryLift.toFixed(3))
  };
}

function estimateMeterProfile(
  beatFrames: number[],
  envelope: number[]
): Pick<
  TrackAnalysisResult,
  'beatsPerBar' | 'timeSignature' | 'meterConfidence' | 'accentPattern' | 'downbeatOffsetMs'
> {
  if (beatFrames.length === 0) {
    const meter = getDefaultMeterMetadata();
    return {
      beatsPerBar: meter.beatsPerBar,
      timeSignature: meter.timeSignature,
      meterConfidence: 0,
      accentPattern: meter.accentPattern,
      downbeatOffsetMs: 0
    };
  }

  const candidates = SUPPORTED_METERS.map((signature) =>
    scoreMeterCandidate(beatFrames, envelope, signature)
  ).sort((left, right) => right.score - left.score);

  let bestIndex = 0;
  const best = candidates[0];
  const sixEightIndex = candidates.findIndex((candidate) => candidate.timeSignature === '6/8');
  if (best?.timeSignature === '3/4' && sixEightIndex >= 0) {
    const sixEight = candidates[sixEightIndex];
    const scoreGap = best.score - sixEight.score;
    if (
      scoreGap <= 0.08 &&
      best.primaryAlternation >= 0.12 &&
      sixEight.secondaryLift >= 0.12
    ) {
      bestIndex = sixEightIndex;
    }
  }

  const selected = candidates[bestIndex] ?? candidates[0];
  const runnerUp = candidates.find((_, index) => index !== bestIndex);
  const confidence = Number(
    Math.max(
      0,
      Math.min(
        1,
        selected.score / Math.max(selected.score + (runnerUp?.score ?? 0), 1e-6)
      )
    ).toFixed(3)
  );

  return {
    beatsPerBar: selected.beatsPerBar,
    timeSignature: selected.timeSignature,
    meterConfidence: confidence,
    accentPattern: selected.accentPattern,
    downbeatOffsetMs: frameIndexToMs(selected.downbeatFrame)
  };
}

export function analyzeTempoFromSamples(
  samples: Int16Array
): Omit<TrackAnalysisResult, 'filePath'> {
  const envelope = buildOnsetEnvelope(samples);
  const fallbackMeter = getDefaultMeterMetadata();
  if (envelope.length < 32) {
    return {
      bpm: 0,
      firstBeatMs: 0,
      downbeatOffsetMs: 0,
      beatsPerBar: fallbackMeter.beatsPerBar,
      timeSignature: fallbackMeter.timeSignature,
      analysisConfidence: 0,
      meterConfidence: 0,
      accentPattern: fallbackMeter.accentPattern
    };
  }

  let bestBpm = 0;
  let bestScore = 0;
  let secondScore = 0;
  let bestLagFrames = 0;

  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += BPM_STEP) {
    const lagFrames = Math.round((60 * SAMPLE_RATE) / (bpm * HOP_SIZE));
    const score = scoreBpm(envelope, lagFrames);
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestBpm = bpm;
      bestLagFrames = lagFrames;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  if (bestBpm <= 0 || bestLagFrames <= 0) {
    return {
      bpm: 0,
      firstBeatMs: 0,
      downbeatOffsetMs: 0,
      beatsPerBar: fallbackMeter.beatsPerBar,
      timeSignature: fallbackMeter.timeSignature,
      analysisConfidence: 0,
      meterConfidence: 0,
      accentPattern: fallbackMeter.accentPattern
    };
  }

  const beatFrames = estimateBeatFrames(envelope, bestLagFrames);
  const firstBeatMs = frameIndexToMs(beatFrames[0] ?? 0);
  const meterProfile = estimateMeterProfile(beatFrames, envelope);
  const analysisConfidence = Number(
    Math.max(0, Math.min(1, bestScore / Math.max(bestScore + secondScore, 1e-6))).toFixed(3)
  );

  return {
    bpm: Number(bestBpm.toFixed(2)),
    firstBeatMs,
    downbeatOffsetMs: meterProfile.downbeatOffsetMs,
    beatsPerBar: meterProfile.beatsPerBar,
    timeSignature: meterProfile.timeSignature,
    analysisConfidence,
    meterConfidence: meterProfile.meterConfidence,
    accentPattern: meterProfile.accentPattern
  };
}

export async function detectTempo(
  ffmpegPath: string,
  filePath: string,
  analysisSeconds: number
): Promise<TrackAnalysisResult> {
  const samples = await decodeAudioToMonoPcm(ffmpegPath, filePath, analysisSeconds);
  return {
    filePath,
    ...analyzeTempoFromSamples(samples)
  };
}
