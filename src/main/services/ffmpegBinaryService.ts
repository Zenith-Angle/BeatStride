import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { FfmpegBinaryConfig } from '@shared/types';
import { getPlatformExeName } from '@shared/utils/platform';

interface BinaryCandidates {
  ffmpegCandidates: string[];
  ffprobeCandidates: string[];
}

function getBinaryCandidates(overrides?: {
  ffmpegPath?: string;
  ffprobePath?: string;
}): BinaryCandidates {
  const appPath = app.getAppPath();
  const resourcesPath = process.resourcesPath;
  const ffmpegName = getPlatformExeName('ffmpeg');
  const ffprobeName = getPlatformExeName('ffprobe');

  const defaults = [
    path.join(appPath, 'resources', 'ffmpeg'),
    path.join(appPath, 'ffmpeg'),
    path.join(resourcesPath, 'ffmpeg')
  ];

  const ffmpegCandidates = [
    overrides?.ffmpegPath,
    ...defaults.map((dir) => path.join(dir, ffmpegName))
  ].filter(Boolean) as string[];

  const ffprobeCandidates = [
    overrides?.ffprobePath,
    ...defaults.map((dir) => path.join(dir, ffprobeName))
  ].filter(Boolean) as string[];

  return { ffmpegCandidates, ffprobeCandidates };
}

function pickExisting(candidates: string[]): string {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return '';
}

export function detectFfmpegBinaries(overrides?: {
  ffmpegPath?: string;
  ffprobePath?: string;
}): FfmpegBinaryConfig {
  const { ffmpegCandidates, ffprobeCandidates } = getBinaryCandidates(overrides);
  const ffmpegPath = pickExisting(ffmpegCandidates);
  const ffprobePath = pickExisting(ffprobeCandidates);
  const available = Boolean(ffmpegPath && ffprobePath);

  return {
    ffmpegPath,
    ffprobePath,
    available,
    lastCheckedAt: new Date().toISOString(),
    message: available ? 'ok' : 'ffmpeg_or_ffprobe_missing'
  };
}
