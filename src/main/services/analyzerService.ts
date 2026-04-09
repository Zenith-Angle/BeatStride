import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import type {
  MixTuningSettings,
  MetronomeRenderRequest,
  MetronomeRenderResult,
  TrackAnalysisResult,
  TrackAlignmentSuggestionResult,
  TimeSignature
} from '@shared/types';

interface AnalyzerResponse<T> {
  results: T[];
}

interface AnalyzerSingleResponse<T> {
  result: T;
}

interface AnalyzerCommandCandidate {
  command: string;
  args: string[];
}

function resolveAppRoot(): string {
  const appPath = app.getAppPath();
  const normalized = path.normalize(appPath);
  if (normalized.endsWith(`${path.sep}out`)) {
    return path.dirname(normalized);
  }
  return normalized;
}

function buildEnv(ffmpegPath?: string): NodeJS.ProcessEnv {
  if (!ffmpegPath) {
    return { ...process.env };
  }
  const ffmpegDir = path.dirname(ffmpegPath);
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  const currentPath = process.env[pathKey] ?? '';
  return {
    ...process.env,
    [pathKey]: `${ffmpegDir}${path.delimiter}${currentPath}`,
    BEATSTRIDE_FFMPEG_PATH: ffmpegPath
  };
}

function resolveAnalyzerCandidates(): AnalyzerCommandCandidate[] {
  const appRoot = resolveAppRoot();
  const packagedExe = path.join(process.resourcesPath, 'python-analyzer', 'beatstride-analyzer.exe');
  const resourceExe = path.join(appRoot, 'resources', 'python-analyzer', 'beatstride-analyzer.exe');
  const repoExe = path.join(appRoot, 'python-analyzer', 'dist', 'beatstride-analyzer.exe');
  const scriptPath = path.join(appRoot, 'python-analyzer', 'beatstride_analyzer.py');

  const candidates: AnalyzerCommandCandidate[] = [];
  for (const exePath of [packagedExe, resourceExe, repoExe]) {
    if (fs.existsSync(exePath)) {
      candidates.push({ command: exePath, args: [] });
    }
  }

  if (fs.existsSync(scriptPath)) {
    candidates.push({ command: 'py', args: ['-3', scriptPath] });
    candidates.push({ command: 'python', args: [scriptPath] });
  }

  return candidates;
}

function invokeAnalyzer(
  candidate: AnalyzerCommandCandidate,
  subcommand: string,
  payload: unknown,
  ffmpegPath?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(candidate.command, [...candidate.args, subcommand], {
      cwd: resolveAppRoot(),
      env: buildEnv(ffmpegPath),
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `analyzer exited with ${code}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export class AnalyzerService {
  async analyzeTracks(
    payload: {
      tracks: Array<{ filePath: string }>;
      analysisSeconds: number;
    },
    ffmpegPath?: string
  ): Promise<TrackAnalysisResult[]> {
    return this.invokeMany<TrackAnalysisResult>('analyze-tracks', payload, ffmpegPath);
  }

  async suggestTrackAlignments(
    payload: {
      tracks: Array<{
        filePath: string;
        bpm: number;
        targetBpm?: number;
        downbeatOffsetMs: number;
        beatsPerBar: number;
        timeSignature: TimeSignature;
      }>;
      globalTargetBpm: number;
      mixTuning: Pick<
        MixTuningSettings,
        'harmonicTolerance' | 'harmonicMappingEnabled' | 'halfMapUpperBpm'
      >;
    },
    ffmpegPath?: string
    ): Promise<TrackAlignmentSuggestionResult[]> {
    return this.invokeMany<TrackAlignmentSuggestionResult>(
      'suggest-track-alignments',
      payload,
      ffmpegPath
    );
  }

  async renderMetronomeTrack(
    payload: MetronomeRenderRequest,
    ffmpegPath?: string
  ): Promise<MetronomeRenderResult> {
    return this.invokeSingle<MetronomeRenderResult>('render-metronome-track', payload, ffmpegPath);
  }

  private async invokeMany<T>(
    subcommand: string,
    payload: unknown,
    ffmpegPath?: string
  ): Promise<T[]> {
    const candidates = resolveAnalyzerCandidates();
    if (candidates.length === 0) {
      throw new Error('未找到 beatstride-analyzer，可先构建 sidecar 或使用 TS fallback。');
    }

    const errors: string[] = [];
    for (const candidate of candidates) {
      try {
        const stdout = await invokeAnalyzer(candidate, subcommand, payload, ffmpegPath);
        const parsed = JSON.parse(stdout) as AnalyzerResponse<T>;
        return parsed.results ?? [];
      } catch (error) {
        errors.push(
          `${candidate.command}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    throw new Error(errors.join(' | '));
  }

  private async invokeSingle<T>(
    subcommand: string,
    payload: unknown,
    ffmpegPath?: string
  ): Promise<T> {
    const candidates = resolveAnalyzerCandidates();
    if (candidates.length === 0) {
      throw new Error('未找到 beatstride-analyzer，可先构建 sidecar。');
    }

    const errors: string[] = [];
    for (const candidate of candidates) {
      try {
        const stdout = await invokeAnalyzer(candidate, subcommand, payload, ffmpegPath);
        const parsed = JSON.parse(stdout) as AnalyzerSingleResponse<T>;
        return parsed.result;
      } catch (error) {
        errors.push(
          `${candidate.command}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    throw new Error(errors.join(' | '));
  }
}
