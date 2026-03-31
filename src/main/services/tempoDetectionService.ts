import { spawn } from 'node:child_process';
import type { TempoAnalysisResult } from '@shared/types';

const SAMPLE_RATE = 22050;
const CHANNELS = 1;
const FRAME_SIZE = 1024;
const HOP_SIZE = 512;
const MIN_BPM = 70;
const MAX_BPM = 210;
const BPM_STEP = 0.5;

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

function detectTempoFromSamples(samples: Int16Array): TempoAnalysisResult {
  const envelope = buildOnsetEnvelope(samples);
  if (envelope.length < 32) {
    return { bpm: 0, confidence: 0 };
  }

  let bestBpm = 0;
  let bestScore = 0;
  let secondScore = 0;

  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += BPM_STEP) {
    const lagFrames = Math.round((60 * SAMPLE_RATE) / (bpm * HOP_SIZE));
    const score = scoreBpm(envelope, lagFrames);
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestBpm = bpm;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  if (bestBpm <= 0) {
    return { bpm: 0, confidence: 0 };
  }

  const confidence = Number(
    Math.max(0, Math.min(1, bestScore / Math.max(bestScore + secondScore, 1e-6))).toFixed(3)
  );

  return {
    bpm: Number(bestBpm.toFixed(2)),
    confidence
  };
}

export async function detectTempo(
  ffmpegPath: string,
  filePath: string,
  analysisSeconds: number
): Promise<TempoAnalysisResult> {
  const samples = await decodeAudioToMonoPcm(ffmpegPath, filePath, analysisSeconds);
  return detectTempoFromSamples(samples);
}
