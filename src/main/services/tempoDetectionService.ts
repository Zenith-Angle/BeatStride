import { spawn } from 'node:child_process';
import type { TempoAnalysisResult } from '@shared/types';

const SAMPLE_RATE = 22050;
const CHANNELS = 1;
const FRAME_SIZE = 1024;
const HOP_SIZE = 512;
const MIN_BPM = 70;
const MAX_BPM = 210;
const BPM_STEP = 0.5;

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
  const normalized = envelope.map((value, index) => Math.max(0, value - (baseline[index] ?? 0) * 0.9));
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

function estimateDownbeatFrame(
  beatFrames: number[],
  envelope: number[],
  beatsPerBar: number
): number {
  if (beatFrames.length === 0) {
    return 0;
  }

  const safeBeatsPerBar = Math.max(1, Math.round(beatsPerBar));
  if (beatFrames.length < safeBeatsPerBar) {
    return beatFrames[0] ?? 0;
  }

  const beatStrengths = beatFrames.map((frame) => sampleEnvelopePeak(envelope, frame, 1).value);
  let bestPhase = 0;
  let bestScore = -1;

  for (let phase = 0; phase < safeBeatsPerBar; phase += 1) {
    let score = 0;
    for (let index = phase; index < beatStrengths.length; index += safeBeatsPerBar) {
      score += beatStrengths[index] ?? 0;
    }
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }

  return beatFrames[bestPhase] ?? beatFrames[0] ?? 0;
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

export function analyzeTempoFromSamples(
  samples: Int16Array,
  beatsPerBar = 4
): TempoAnalysisResult {
  const envelope = buildOnsetEnvelope(samples);
  if (envelope.length < 32) {
    return { bpm: 0, confidence: 0, firstBeatMs: 0, downbeatOffsetMs: 0 };
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
    return { bpm: 0, confidence: 0, firstBeatMs: 0, downbeatOffsetMs: 0 };
  }

  const confidence = Number(
    Math.max(0, Math.min(1, bestScore / Math.max(bestScore + secondScore, 1e-6))).toFixed(3)
  );
  const beatFrames = estimateBeatFrames(envelope, bestLagFrames);
  const firstBeatMs = frameIndexToMs(beatFrames[0] ?? 0);
  const downbeatOffsetMs = frameIndexToMs(
    estimateDownbeatFrame(beatFrames, envelope, beatsPerBar)
  );

  return {
    bpm: Number(bestBpm.toFixed(2)),
    confidence,
    firstBeatMs,
    downbeatOffsetMs
  };
}

export async function detectTempo(
  ffmpegPath: string,
  filePath: string,
  analysisSeconds: number,
  beatsPerBar = 4
): Promise<TempoAnalysisResult> {
  const samples = await decodeAudioToMonoPcm(ffmpegPath, filePath, analysisSeconds);
  return analyzeTempoFromSamples(samples, beatsPerBar);
}
