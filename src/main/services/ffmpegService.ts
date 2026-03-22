import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import type { MedleyExportPlan, SingleTrackExportPlan } from '@shared/types';
import {
  buildMedleyMixFilter,
  buildOutputCodecArgs,
  buildSingleTrackFilterGraph
} from '@shared/services/ffmpegArgsBuilder';
import { msToSec } from '@shared/utils/time';

export interface FfmpegProgress {
  ratio: number;
  timeMs: number;
  logLine: string;
}

function parseFfmpegTimeToMs(timeString: string): number {
  const [hh, mm, ss] = timeString.split(':');
  const sec = Number(ss);
  return Math.round((Number(hh) * 3600 + Number(mm) * 60 + sec) * 1000);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

async function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  totalMs: number,
  onProgress?: (progress: FfmpegProgress) => void
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    let buffer = '';

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const match = line.match(/time=(\d+:\d+:\d+(?:\.\d+)?)/);
        if (match?.[1] && onProgress) {
          const timeMs = parseFfmpegTimeToMs(match[1]);
          const ratio = totalMs > 0 ? Math.min(1, timeMs / totalMs) : 0;
          onProgress({ ratio, timeMs, logLine: line });
        }
      }
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `ffmpeg exited with ${code}`));
    });
  });
}

async function createSilence(
  ffmpegPath: string,
  durationMs: number,
  outputPath: string
): Promise<void> {
  const args = [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=48000:cl=stereo',
    '-t',
    `${msToSec(durationMs)}`,
    '-c:a',
    'pcm_s16le',
    outputPath
  ];
  await runFfmpeg(ffmpegPath, args, durationMs);
}

async function createMetronomeTrack(
  ffmpegPath: string,
  samplePath: string,
  beatTimesMs: number[],
  durationMs: number,
  outputPath: string
): Promise<void> {
  if (beatTimesMs.length === 0 || !samplePath || !fs.existsSync(samplePath)) {
    await createSilence(ffmpegPath, durationMs, outputPath);
    return;
  }

  const clickSec = 0.05;
  const nodes = beatTimesMs.map((time, idx) => {
    const delay = Math.max(0, Math.round(time));
    return `[0:a]atrim=0:${clickSec},asetpts=PTS-STARTPTS,adelay=${delay}|${delay}[c${idx}]`;
  });
  const mixInputs = beatTimesMs.map((_, idx) => `[c${idx}]`).join('');
  const filter = `${nodes.join(';')};${mixInputs}amix=inputs=${beatTimesMs.length}:normalize=0,atrim=0:${msToSec(durationMs)}[out]`;

  const args = [
    '-y',
    '-i',
    samplePath,
    '-filter_complex',
    filter,
    '-map',
    '[out]',
    '-c:a',
    'pcm_s16le',
    outputPath
  ];

  await runFfmpeg(ffmpegPath, args, durationMs);
}

async function renderSingleToFile(
  ffmpegPath: string,
  plan: SingleTrackExportPlan,
  outputPath: string,
  bitrateKbps: number,
  onProgress?: (progress: FfmpegProgress) => void
): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beatstride-single-'));
  const metronomePath = path.join(tempDir, 'metronome.wav');

  let metronomeInputIndex: number | undefined;
  if (plan.track.metronomeEnabled) {
    await createMetronomeTrack(
      ffmpegPath,
      plan.metronomeSamplePath,
      plan.track.beatTimesMs,
      Math.round(plan.track.processedDurationMs),
      metronomePath
    );
    metronomeInputIndex = 1;
  }

  const { graph, outputLabel } = buildSingleTrackFilterGraph(plan, metronomeInputIndex);
  const args = ['-y', '-i', plan.track.sourceFilePath];
  if (metronomeInputIndex !== undefined) {
    args.push('-i', metronomePath);
  }
  args.push(
    '-filter_complex',
    graph,
    '-map',
    outputLabel,
    ...buildOutputCodecArgs(plan.format, bitrateKbps),
    outputPath
  );

  try {
    await runFfmpeg(ffmpegPath, args, plan.track.processedDurationMs, onProgress);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function exportSingleTrack(
  ffmpegPath: string,
  plan: SingleTrackExportPlan,
  options?: {
    bitrateKbps?: number;
    onProgress?: (progress: FfmpegProgress) => void;
  }
): Promise<string> {
  const outputDir = plan.outputDir || app.getPath('documents');
  ensureDir(outputDir);
  const outputPath = path.join(outputDir, `${plan.track.outputBaseName}.${plan.format}`);
  await renderSingleToFile(
    ffmpegPath,
    plan,
    outputPath,
    options?.bitrateKbps ?? 320,
    options?.onProgress
  );
  return outputPath;
}

interface MedleyRenderedClip {
  filePath: string;
  startMs: number;
  endMs: number;
}

export async function exportMedley(
  ffmpegPath: string,
  plan: MedleyExportPlan,
  options?: {
    bitrateKbps?: number;
    onProgress?: (progress: FfmpegProgress) => void;
  }
): Promise<string> {
  const outputDir = plan.outputDir || app.getPath('documents');
  ensureDir(outputDir);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beatstride-medley-'));

  try {
    const renderedClips: MedleyRenderedClip[] = [];
    for (let i = 0; i < plan.clips.length; i += 1) {
      const clip = plan.clips[i];
      const singlePlan: SingleTrackExportPlan = {
        mode: 'single',
        outputDir: tempDir,
        format: 'wav',
        normalizeLoudness: false,
        metronomeSamplePath: plan.metronomeSamplePath,
        track: {
          ...clip.track,
          outputBaseName: `clip_${i.toString().padStart(3, '0')}`
        }
      };
      const clipPath = path.join(tempDir, `${singlePlan.track.outputBaseName}.wav`);
      await renderSingleToFile(ffmpegPath, singlePlan, clipPath, 320, (progress) => {
        if (!options?.onProgress) {
          return;
        }
        const base = i / Math.max(1, plan.clips.length);
        const ratio = (base + progress.ratio / Math.max(1, plan.clips.length)) * 0.8;
        options.onProgress({ ...progress, ratio: Math.min(0.8, ratio) });
      });
      renderedClips.push({
        filePath: clipPath,
        startMs: clip.timelineStartMs,
        endMs: clip.timelineEndMs
      });
    }

    const inputFiles: string[] = [];
    if (plan.crossfadeMs <= 0) {
      let cursor = 0;
      for (let i = 0; i < renderedClips.length; i += 1) {
        const clip = renderedClips[i];
        if (clip.startMs > cursor) {
          const silencePath = path.join(tempDir, `silence_${i}.wav`);
          await createSilence(ffmpegPath, clip.startMs - cursor, silencePath);
          inputFiles.push(silencePath);
        }
        inputFiles.push(clip.filePath);
        cursor = Math.max(cursor, clip.endMs);
      }
    } else {
      inputFiles.push(...renderedClips.map((item) => item.filePath));
    }

    const args = ['-y'];
    for (const filePath of inputFiles) {
      args.push('-i', filePath);
    }
    const labels = inputFiles.map((_, index) => `[${index}:a]`);
    const { graph, outputLabel } = buildMedleyMixFilter(plan, labels);
    const outputPath = path.join(outputDir, `beatstride_medley.${plan.format}`);

    args.push(
      '-filter_complex',
      graph,
      '-map',
      outputLabel,
      ...buildOutputCodecArgs(plan.format, options?.bitrateKbps ?? 320),
      outputPath
    );

    await runFfmpeg(ffmpegPath, args, plan.durationMs, (progress) => {
      options?.onProgress?.({
        ...progress,
        ratio: 0.8 + progress.ratio * 0.2
      });
    });
    return outputPath;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
