import { spawn } from 'node:child_process';
import type { AudioWaveformData } from '@shared/types';
import { msToSec } from '@shared/utils/time';

const SAMPLE_RATE = 11025;
const CHANNELS = 1;
const DEFAULT_POINT_COUNT = 1200;
const MAX_POINT_COUNT = 4096;

const waveformCache = new Map<string, AudioWaveformData>();

async function decodeAudioSegmentToMonoPcm(
  ffmpegPath: string,
  filePath: string,
  startMs: number,
  durationMs: number
): Promise<Int16Array> {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error'];
    if (startMs > 0) {
      args.push('-ss', msToSec(startMs).toString());
    }
    args.push(
      '-i',
      filePath,
      '-vn',
      '-ac',
      String(CHANNELS),
      '-ar',
      String(SAMPLE_RATE)
    );
    if (durationMs > 0) {
      args.push('-t', msToSec(durationMs).toString());
    }
    args.push('-f', 's16le', 'pipe:1');

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

function buildWaveformPeaks(samples: Int16Array, pointCount: number): number[] {
  if (samples.length === 0 || pointCount <= 0) {
    return [];
  }

  const peaks = new Array<number>(pointCount).fill(0);
  const samplesPerPoint = samples.length / pointCount;

  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const start = Math.floor(pointIndex * samplesPerPoint);
    const end =
      pointIndex === pointCount - 1
        ? samples.length
        : Math.floor((pointIndex + 1) * samplesPerPoint);
    let peak = 0;

    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      const sample = Math.abs(samples[sampleIndex] ?? 0) / 32768;
      if (sample > peak) {
        peak = sample;
      }
    }

    peaks[pointIndex] = peak;
  }

  const globalPeak = Math.max(...peaks, 0.0001);
  return peaks.map((peak) => Number((peak / globalPeak).toFixed(4)));
}

export async function getAudioWaveform(
  ffmpegPath: string,
  payload: {
    filePath: string;
    durationMs: number;
    trimInMs?: number;
    trimOutMs?: number;
    points?: number;
  }
): Promise<AudioWaveformData> {
  const trimInMs = Math.max(0, Math.round(payload.trimInMs ?? 0));
  const trimOutMs = Math.max(0, Math.round(payload.trimOutMs ?? 0));
  const requestedPoints = Math.max(
    64,
    Math.min(MAX_POINT_COUNT, Math.round(payload.points ?? DEFAULT_POINT_COUNT))
  );
  const durationMs = Math.max(1, Math.round(payload.durationMs) - trimInMs - trimOutMs);
  const cacheKey = [
    payload.filePath,
    durationMs,
    trimInMs,
    trimOutMs,
    requestedPoints
  ].join('|');
  const cached = waveformCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const samples = await decodeAudioSegmentToMonoPcm(
    ffmpegPath,
    payload.filePath,
    trimInMs,
    durationMs
  );
  const waveform = {
    peaks: buildWaveformPeaks(samples, requestedPoints),
    durationMs
  } satisfies AudioWaveformData;
  waveformCache.set(cacheKey, waveform);
  return waveform;
}
