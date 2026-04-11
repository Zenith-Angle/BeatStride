import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { FfmpegBinaryConfig } from '@shared/types';
import { getPlatformExeName } from '@shared/utils/platform';

interface DetectOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  autoDetect?: boolean;
}

interface ResolvedPair {
  ffmpegPath: string;
  ffprobePath: string;
  message: string;
}

function getResourceDirs(): string[] {
  const appPath = app.getAppPath();
  return [
    path.join(appPath, 'resources', 'ffmpeg'),
    path.join(appPath, 'ffmpeg'),
    path.join(process.resourcesPath, 'ffmpeg')
  ];
}

function exists(targetPath?: string): targetPath is string {
  if (!targetPath) {
    return false;
  }
  return fs.existsSync(targetPath);
}

function dedupe(items: Array<string | undefined | null>): string[] {
  return [...new Set(items.filter((item): item is string => Boolean(item)))];
}

function resolvePair(
  ffmpegCandidates: string[],
  ffprobeCandidates: string[],
  message: string
): ResolvedPair | null {
  for (const ffmpegPath of ffmpegCandidates) {
    if (!exists(ffmpegPath)) {
      continue;
    }
    for (const ffprobePath of ffprobeCandidates) {
      if (exists(ffprobePath)) {
        return { ffmpegPath, ffprobePath, message };
      }
    }
  }
  return null;
}

function getWindowsCommonDirs(): string[] {
  if (process.platform !== 'win32') {
    return [];
  }

  return dedupe([
    'C:\\ffmpeg\\bin',
    'C:\\Program Files\\ffmpeg\\bin',
    'C:\\Program Files (x86)\\ffmpeg\\bin',
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'scoop', 'shims') : undefined,
    process.env.ProgramData ? path.join(process.env.ProgramData, 'chocolatey', 'bin') : undefined,
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links')
      : undefined
  ]);
}

function getPathDirs(): string[] {
  const delimiter = process.platform === 'win32' ? ';' : ':';
  return dedupe((process.env.PATH ?? '').split(delimiter));
}

function mapDirsToBinaryPaths(dirs: string[], binaryName: string): string[] {
  return dirs.map((dirPath) => path.join(dirPath, binaryName));
}

function detectPair(options?: DetectOptions): ResolvedPair | null {
  const ffmpegName = getPlatformExeName('ffmpeg');
  const ffprobeName = getPlatformExeName('ffprobe');
  const resourceDirs = getResourceDirs();

  const savedPair = resolvePair(
    dedupe([options?.ffmpegPath]),
    dedupe([options?.ffprobePath]),
    'detected_saved_paths'
  );
  if (savedPair) {
    return savedPair;
  }

  const resourcePair = resolvePair(
    mapDirsToBinaryPaths(resourceDirs, ffmpegName),
    mapDirsToBinaryPaths(resourceDirs, ffprobeName),
    'detected_resources'
  );
  if (resourcePair) {
    return resourcePair;
  }

  if (!options?.autoDetect) {
    return null;
  }

  if (process.platform === 'win32') {
    const commonDirs = getWindowsCommonDirs();
    const commonDirPair = resolvePair(
      mapDirsToBinaryPaths(commonDirs, ffmpegName),
      mapDirsToBinaryPaths(commonDirs, ffprobeName),
      'detected_common_dirs'
    );
    if (commonDirPair) {
      return commonDirPair;
    }
  }

  const pathPair = resolvePair(
    mapDirsToBinaryPaths(getPathDirs(), ffmpegName),
    mapDirsToBinaryPaths(getPathDirs(), ffprobeName),
    'detected_path_env'
  );
  if (pathPair) {
    return pathPair;
  }

  return null;
}

export function detectFfmpegBinaries(options?: DetectOptions): FfmpegBinaryConfig {
  const detectedPair = detectPair(options);

  return {
    ffmpegPath: detectedPair?.ffmpegPath ?? '',
    ffprobePath: detectedPair?.ffprobePath ?? '',
    available: Boolean(detectedPair),
    lastCheckedAt: new Date().toISOString(),
    message: detectedPair?.message ?? 'ffmpeg_or_ffprobe_missing'
  };
}
