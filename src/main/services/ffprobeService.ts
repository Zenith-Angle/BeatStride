import { spawn } from 'node:child_process';
import type { AudioProbeInfo } from '@shared/types';

interface FfprobeFormatJson {
  format?: {
    duration?: string;
    format_name?: string;
    bit_rate?: string;
  };
  streams?: Array<{
    codec_type?: string;
    sample_rate?: string;
    channels?: number;
  }>;
}

export async function probeAudioMetadata(
  ffprobePath: string,
  filePath: string
): Promise<AudioProbeInfo> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-show_entries',
      'format=duration,format_name,bit_rate:stream=codec_type,sample_rate,channels',
      '-of',
      'json',
      filePath
    ];
    const child = spawn(ffprobePath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `ffprobe exited with ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as FfprobeFormatJson;
        const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');
        const durationSec = Number(parsed.format?.duration ?? '0');
        resolve({
          durationMs: Math.round(durationSec * 1000),
          sampleRate: Number(audioStream?.sample_rate ?? '44100'),
          channels: Number(audioStream?.channels ?? 2),
          formatName: parsed.format?.format_name ?? 'unknown',
          bitRate: parsed.format?.bit_rate
            ? Number(parsed.format.bit_rate)
            : undefined
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}
