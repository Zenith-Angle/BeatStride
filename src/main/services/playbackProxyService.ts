import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import type { PreparedPlaybackAudio } from '@shared/types';

function getCacheDir(): string {
  const dir = path.join(app.getPath('userData'), 'playback-cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function buildCachePath(sourcePath: string): string {
  const stat = fs.statSync(sourcePath);
  const hash = createHash('sha1')
    .update(`${sourcePath}:${stat.size}:${stat.mtimeMs}`)
    .digest('hex');
  return path.join(getCacheDir(), `${hash}.mp3`);
}

async function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `ffmpeg exited with ${code}`));
    });
  });
}

export async function preparePlaybackProxy(
  ffmpegPath: string,
  sourcePath: string
): Promise<string> {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`试听源文件不存在: ${sourcePath}`);
  }

  const outputPath = buildCachePath(sourcePath);
  if (fs.existsSync(outputPath)) {
    return outputPath;
  }

  await runFfmpeg(ffmpegPath, [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    sourcePath,
    '-vn',
    '-ac',
    '2',
    '-ar',
    '44100',
    '-c:a',
    'libmp3lame',
    '-q:a',
    '4',
    outputPath
  ]);

  return outputPath;
}

export async function preparePlaybackPayload(
  ffmpegPath: string,
  sourcePath: string
): Promise<PreparedPlaybackAudio> {
  const proxyPath = await preparePlaybackProxy(ffmpegPath, sourcePath);
  const buffer = fs.readFileSync(proxyPath);
  return {
    mimeType: 'audio/mpeg',
    fileName: path.basename(proxyPath),
    base64Data: buffer.toString('base64')
  };
}
