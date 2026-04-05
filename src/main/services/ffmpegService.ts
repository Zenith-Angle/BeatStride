import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { app } from 'electron';
import type {
  GeneratedTrackProxy,
  MedleyExportPlan,
  PreparedPlaybackAudio,
  ResolvedStretchEngine,
  SingleTrackExportPlan,
  TrackProxyStatusResult,
  TrackRenderPlan
} from '@shared/types';
import { PROJECT_PROXY_DIRNAME } from '@shared/constants';
import {
  buildAtempoFilter,
  buildMedleyMixFilter,
  buildOutputCodecArgs,
  buildSingleTrackFilterGraph
} from '@shared/services/ffmpegArgsBuilder';
import { generateBeatTimes } from '@shared/services/beatGridService';
import { msToSec } from '@shared/utils/time';

export interface FfmpegProgress {
  ratio: number;
  timeMs: number;
  logLine: string;
}

const filterSupportCache = new Map<string, Map<string, boolean>>();
const FILTER_SCRIPT_THRESHOLD = 4000;
const TRACK_PROXY_BITRATE_KBPS = 160;
const PREVIEW_BITRATE_KBPS = 160;

function parseFfmpegTimeToMs(timeString: string): number {
  const [hh, mm, ss] = timeString.split(':');
  const sec = Number(ss);
  return Math.round((Number(hh) * 3600 + Number(mm) * 60 + sec) * 1000);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function createFilterGraphArgs(
  graph: string,
  tempDir: string,
  prefix: string
): {
  args: string[];
  cleanup: () => void;
} {
  if (graph.length <= FILTER_SCRIPT_THRESHOLD) {
    return {
      args: ['-filter_complex', graph],
      cleanup: () => undefined
    };
  }

  ensureDir(tempDir);
  const scriptPath = path.join(
    tempDir,
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`
  );
  fs.writeFileSync(scriptPath, graph, 'utf-8');
  return {
    args: ['-filter_complex_script', scriptPath],
    cleanup: () => {
      fs.rmSync(scriptPath, { force: true });
    }
  };
}

function sanitizeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim() || 'track';
}

function buildTrackProxyPrefix(trackId: string): string {
  const stableId = createHash('sha1').update(trackId).digest('hex').slice(0, 16);
  return `${stableId}__`;
}

function createPreparedFilePayload(filePath: string): PreparedPlaybackAudio {
  return {
    mimeType: 'audio/mpeg',
    fileName: path.basename(filePath),
    filePath
  };
}

function getPreviewCacheDir(kind: 'single' | 'medley'): string {
  const dir = path.join(app.getPath('userData'), 'preview-cache', kind);
  ensureDir(dir);
  return dir;
}

function buildFileStatSignature(filePath?: string): Record<string, number | string | null> {
  if (!filePath || !fs.existsSync(filePath)) {
    return { path: filePath ?? null, size: null, mtimeMs: null };
  }
  const stat = fs.statSync(filePath);
  return {
    path: path.resolve(filePath),
    size: stat.size,
    mtimeMs: stat.mtimeMs
  };
}

function buildTrackProxySignature(plan: SingleTrackExportPlan): string {
  const sourceStat = fs.statSync(plan.track.sourceFilePath);
  return createHash('sha1')
    .update(
      JSON.stringify({
        sourceFilePath: path.resolve(plan.track.sourceFilePath),
        sourceSize: sourceStat.size,
        sourceMtimeMs: sourceStat.mtimeMs,
        proxyFormat: 'mp3',
        sampleRate: 44100,
        channels: 2,
        bitrateKbps: TRACK_PROXY_BITRATE_KBPS
      })
    )
    .digest('hex');
}

function getProjectProxyDir(projectFilePath?: string): string | null {
  if (!projectFilePath) {
    return null;
  }
  return path.join(path.dirname(projectFilePath), PROJECT_PROXY_DIRNAME);
}

function buildProjectProxyPath(projectFilePath: string, plan: SingleTrackExportPlan): string {
  const signature = buildTrackProxySignature(plan);
  const baseName = sanitizeFileName(plan.track.trackName);
  const trackPrefix = buildTrackProxyPrefix(plan.track.trackId);
  return path.join(
    getProjectProxyDir(projectFilePath) ?? path.dirname(projectFilePath),
    `${trackPrefix}${baseName}__${signature.slice(0, 12)}.mp3`
  );
}

function cleanupStaleTrackProxies(projectFilePath: string, trackId: string, keepPath: string): void {
  const proxyDir = getProjectProxyDir(projectFilePath);
  if (!proxyDir || !fs.existsSync(proxyDir)) {
    return;
  }
  const prefix = buildTrackProxyPrefix(trackId);
  const legacyPrefix = `${trackId}__`;
  for (const entry of fs.readdirSync(proxyDir, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      (!entry.name.startsWith(prefix) && !entry.name.startsWith(legacyPrefix))
    ) {
      continue;
    }
    const candidate = path.join(proxyDir, entry.name);
    if (candidate !== keepPath) {
      fs.rmSync(candidate, { force: true });
    }
  }
}

function tryReuseProjectProxy(plan: SingleTrackExportPlan): string | null {
  if (!plan.projectFilePath) {
    return null;
  }
  const proxyPath = buildProjectProxyPath(plan.projectFilePath, plan);
  return fs.existsSync(proxyPath) ? proxyPath : null;
}

function resolveSinglePreviewSourcePlan(plan: SingleTrackExportPlan): {
  plan: SingleTrackExportPlan;
  usedProxy: boolean;
} {
  const proxyPath = tryReuseProjectProxy(plan);
  if (!proxyPath) {
    return { plan, usedProxy: false };
  }
  return {
    plan: {
      ...plan,
      track: {
        ...plan.track,
        sourceFilePath: proxyPath
      }
    },
    usedProxy: true
  };
}

function buildClipProxyLookupPlan(
  plan: MedleyExportPlan,
  clip: MedleyExportPlan['clips'][number]
): SingleTrackExportPlan {
  return {
    mode: 'single',
    projectFilePath: plan.projectFilePath,
    outputDir: plan.outputDir,
    format: plan.format,
    normalizeLoudness: plan.normalizeLoudness,
    metronomeSamplePath: plan.metronomeSamplePath,
    renderOptions: plan.renderOptions,
    track: clip.track
  };
}

function resolveMedleyPreviewSourcePlan(plan: MedleyExportPlan): {
  plan: MedleyExportPlan;
  usedProxyTrackCount: number;
} {
  let usedProxyTrackCount = 0;
  const nextClips = plan.clips.map((clip) => {
    const proxyPath = tryReuseProjectProxy(buildClipProxyLookupPlan(plan, clip));
    if (!proxyPath) {
      return clip;
    }
    usedProxyTrackCount += 1;
    return {
      ...clip,
      track: {
        ...clip.track,
        sourceFilePath: proxyPath
      }
    };
  });

  if (usedProxyTrackCount === 0) {
    return { plan, usedProxyTrackCount: 0 };
  }

  return {
    plan: {
      ...plan,
      clips: nextClips
    },
    usedProxyTrackCount
  };
}

function hasAnyTrackProxy(projectFilePath: string, trackId: string): boolean {
  const proxyDir = getProjectProxyDir(projectFilePath);
  if (!proxyDir || !fs.existsSync(proxyDir)) {
    return false;
  }
  const prefix = buildTrackProxyPrefix(trackId);
  const legacyPrefix = `${trackId}__`;
  return fs.readdirSync(proxyDir, { withFileTypes: true }).some(
    (entry) =>
      entry.isFile() && (entry.name.startsWith(prefix) || entry.name.startsWith(legacyPrefix))
  );
}

function ffmpegHasFilter(ffmpegPath: string, filterName: string): boolean {
  const byBinary = filterSupportCache.get(ffmpegPath) ?? new Map<string, boolean>();
  if (byBinary.has(filterName)) {
    return byBinary.get(filterName) ?? false;
  }

  const completed = spawnSync(ffmpegPath, ['-hide_banner', '-h', `filter=${filterName}`], {
    windowsHide: true,
    encoding: 'utf-8'
  });
  const text = `${completed.stdout ?? ''}\n${completed.stderr ?? ''}`.toLowerCase();
  const supported = !text.includes('unknown filter') && completed.status === 0;
  byBinary.set(filterName, supported);
  filterSupportCache.set(ffmpegPath, byBinary);
  return supported;
}

function resolveStretchEngine(
  ffmpegPath: string,
  requested: SingleTrackExportPlan['renderOptions']['stretchEngine']
): ResolvedStretchEngine {
  if (requested === 'rubberband') {
    if (!ffmpegHasFilter(ffmpegPath, 'rubberband')) {
      throw new Error('当前 ffmpeg 未启用 rubberband，无法使用该变速引擎。');
    }
    return 'rubberband';
  }

  if (requested === 'auto') {
    return ffmpegHasFilter(ffmpegPath, 'rubberband') ? 'rubberband' : 'atempo';
  }

  return 'atempo';
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
    child.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENAMETOOLONG') {
        reject(new Error('ffmpeg 命令长度超限，已尝试缩短滤镜参数但仍然失败。'));
        return;
      }
      reject(error);
    });
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
  const safeDurationMs = Math.max(1, durationMs);
  const args = [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=48000:cl=stereo',
    '-t',
    `${msToSec(safeDurationMs)}`,
    '-c:a',
    'pcm_s16le',
    outputPath
  ];
  await runFfmpeg(ffmpegPath, args, safeDurationMs);
}

async function renderMaterialProxy(
  ffmpegPath: string,
  sourceFilePath: string,
  outputPath: string,
  totalMs: number,
  bitrateKbps: number
): Promise<void> {
  await runFfmpeg(
    ffmpegPath,
    [
      '-y',
      '-i',
      sourceFilePath,
      '-vn',
      '-map',
      '0:a:0',
      '-ac',
      '2',
      '-ar',
      '44100',
      '-c:a',
      'libmp3lame',
      '-b:a',
      `${bitrateKbps}k`,
      outputPath
    ],
    Math.max(1, totalMs)
  );
}

function buildPreviewBeatTimes(
  track: TrackRenderPlan
): number[] {
  return generateBeatTimes(
    track.processedDurationMs,
    track.metronomeBpm,
    track.metronomeStartMs
  );
}

function buildSinglePreviewPlan(
  plan: SingleTrackExportPlan,
  mode: 'original' | 'processed' | 'metronome'
): SingleTrackExportPlan {
  if (mode === 'original') {
    return {
      ...plan,
      track: {
        ...plan.track,
        speedRatio: 1,
        processedDurationMs: plan.track.trimmedSourceDurationMs,
        beatTimesMs: [],
        metronomeEnabled: false
      }
    };
  }

  if (mode === 'processed') {
    return {
      ...plan,
      track: {
        ...plan.track,
        beatTimesMs: [],
        metronomeEnabled: false
      }
    };
  }

  return {
    ...plan,
    track: {
      ...plan.track,
      beatTimesMs: buildPreviewBeatTimes(plan.track),
      metronomeEnabled: true
    }
  };
}

function buildMedleyPreviewPlan(
  plan: MedleyExportPlan,
  mode: 'processed' | 'metronome'
): MedleyExportPlan {
  return {
    ...plan,
    clips: plan.clips.map((clip) => ({
      ...clip,
      track:
        mode === 'processed'
          ? {
              ...clip.track,
              beatTimesMs: [],
              metronomeEnabled: false
            }
          : {
              ...clip.track,
              beatTimesMs: buildPreviewBeatTimes(clip.track),
              metronomeEnabled: true
            }
    }))
  };
}

function buildSinglePreviewCachePath(
  plan: SingleTrackExportPlan,
  mode: 'original' | 'processed' | 'metronome'
): string {
  const derivedPlan = buildSinglePreviewPlan(plan, mode);
  const signature = createHash('sha1')
    .update(
      JSON.stringify({
        mode,
        plan: derivedPlan,
        source: buildFileStatSignature(derivedPlan.track.sourceFilePath),
        metronomeSample: buildFileStatSignature(plan.metronomeSamplePath),
        bitrateKbps: PREVIEW_BITRATE_KBPS
      })
    )
    .digest('hex');
  const baseName = sanitizeFileName(plan.track.trackName);
  return path.join(getPreviewCacheDir('single'), `${baseName}__${signature.slice(0, 16)}.mp3`);
}

function buildMedleyPreviewCachePath(
  plan: MedleyExportPlan,
  mode: 'processed' | 'metronome'
): string {
  const derivedPlan = buildMedleyPreviewPlan(plan, mode);
  const signature = createHash('sha1')
    .update(
      JSON.stringify({
        mode,
        plan: derivedPlan,
        sources: derivedPlan.clips.map((clip) => buildFileStatSignature(clip.track.sourceFilePath)),
        metronomeSample: buildFileStatSignature(plan.metronomeSamplePath),
        bitrateKbps: PREVIEW_BITRATE_KBPS
      })
    )
    .digest('hex');
  return path.join(getPreviewCacheDir('medley'), `medley__${signature.slice(0, 16)}.mp3`);
}

async function createMetronomeTrack(
  ffmpegPath: string,
  samplePath: string,
  beatTimesMs: number[],
  durationMs: number,
  options: {
    beatRenderMode: SingleTrackExportPlan['renderOptions']['beatRenderMode'];
    beatOriginalBpm: number;
    metronomeBpm: number;
    accentPattern: number[];
  },
  outputPath: string
): Promise<void> {
  if (durationMs <= 0) {
    await createSilence(ffmpegPath, 0, outputPath);
    return;
  }

  const sampleExists = Boolean(samplePath && fs.existsSync(samplePath));
  if (options.beatRenderMode === 'stretched-file' && sampleExists) {
    if (beatTimesMs.length === 0) {
      await createSilence(ffmpegPath, durationMs, outputPath);
      return;
    }

    const ratio =
      options.beatOriginalBpm > 0 ? options.metronomeBpm / options.beatOriginalBpm : 1;
    const firstBeatMs = Math.max(0, Math.round(beatTimesMs[0] ?? 0));
    const activeDurationMs = Math.max(0, durationMs - firstBeatMs);
    if (activeDurationMs <= 0) {
      await createSilence(ffmpegPath, durationMs, outputPath);
      return;
    }

    const filter =
      `[0:a]${buildAtempoFilter(Math.max(0.01, ratio))},` +
      `atrim=0:${msToSec(activeDurationMs)},asetpts=PTS-STARTPTS,` +
      `adelay=${firstBeatMs}|${firstBeatMs},atrim=0:${msToSec(durationMs)}[out]`;
    const filterGraph = createFilterGraphArgs(filter, path.dirname(outputPath), 'metronome-file');
    const args = [
      '-y',
      '-stream_loop',
      '-1',
      '-i',
      samplePath,
      ...filterGraph.args,
      '-map',
      '[out]',
      '-c:a',
      'pcm_s16le',
      outputPath
    ];
    try {
      await runFfmpeg(ffmpegPath, args, durationMs);
    } finally {
      filterGraph.cleanup();
    }
    return;
  }

  if (beatTimesMs.length === 0) {
    await createSilence(ffmpegPath, durationMs, outputPath);
    return;
  }

  let effectiveSamplePath = samplePath;
  let cleanupSyntheticSample = false;
  if (!sampleExists) {
    effectiveSamplePath = path.join(path.dirname(outputPath), 'synthetic-click.wav');
    cleanupSyntheticSample = true;
    const frequency = options.beatRenderMode === 'crisp-click' ? '1780' : '1450';
    const clickSec = options.beatRenderMode === 'crisp-click' ? '0.035' : '0.06';
    await runFfmpeg(
      ffmpegPath,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${frequency}:duration=${clickSec}:sample_rate=48000`,
        '-af',
        'afade=t=in:st=0:d=0.002,afade=t=out:st=0.018:d=0.018',
        '-c:a',
        'pcm_s16le',
        effectiveSamplePath
      ],
      60
    );
  }

  const clickSec = options.beatRenderMode === 'crisp-click' ? 0.035 : 0.06;
  const accentPattern = options.accentPattern.length > 0 ? options.accentPattern : [1.35, 1, 1, 1];
  const nodes = beatTimesMs.map((time, idx) => {
    const delay = Math.max(0, Math.round(time));
    const accentGain = accentPattern[idx % accentPattern.length] ?? 1;
    return `[0:a]atrim=0:${clickSec},asetpts=PTS-STARTPTS,volume=${accentGain},adelay=${delay}|${delay}[c${idx}]`;
  });
  const mixInputs = beatTimesMs.map((_, idx) => `[c${idx}]`).join('');
  const filter = `${nodes.join(';')};${mixInputs}amix=inputs=${beatTimesMs.length}:normalize=0,atrim=0:${msToSec(durationMs)}[out]`;
  const filterGraph = createFilterGraphArgs(filter, path.dirname(outputPath), 'metronome-filter');

  const args = [
    '-y',
    '-i',
    effectiveSamplePath,
    ...filterGraph.args,
    '-map',
    '[out]',
    '-c:a',
    'pcm_s16le',
    outputPath
  ];

  try {
    await runFfmpeg(ffmpegPath, args, durationMs);
  } finally {
    filterGraph.cleanup();
    if (cleanupSyntheticSample) {
      fs.rmSync(effectiveSamplePath, { force: true });
    }
  }
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
  const resolvedPlan: SingleTrackExportPlan = {
    ...plan,
    renderOptions: {
      ...plan.renderOptions,
      resolvedStretchEngine: resolveStretchEngine(ffmpegPath, plan.renderOptions.stretchEngine)
    }
  };

  let metronomeInputIndex: number | undefined;
  if (resolvedPlan.track.metronomeEnabled) {
    await createMetronomeTrack(
      ffmpegPath,
      resolvedPlan.metronomeSamplePath,
      resolvedPlan.track.beatTimesMs,
      Math.round(resolvedPlan.track.processedDurationMs),
      {
        beatRenderMode: resolvedPlan.renderOptions.beatRenderMode,
        beatOriginalBpm: resolvedPlan.renderOptions.beatOriginalBpm,
        metronomeBpm: resolvedPlan.track.metronomeBpm,
        accentPattern: resolvedPlan.track.accentPattern
      },
      metronomePath
    );
    metronomeInputIndex = 1;
  }

  const { graph, outputLabel } = buildSingleTrackFilterGraph(resolvedPlan, metronomeInputIndex);
  const filterGraph = createFilterGraphArgs(graph, tempDir, 'single-filter');
  const args = ['-y', '-i', resolvedPlan.track.sourceFilePath];
  if (metronomeInputIndex !== undefined) {
    args.push('-i', metronomePath);
  }
  args.push(
    ...filterGraph.args,
    '-map',
    outputLabel,
    ...buildOutputCodecArgs(plan.format, bitrateKbps),
    outputPath
  );

  try {
    await runFfmpeg(ffmpegPath, args, resolvedPlan.track.processedDurationMs, onProgress);
  } finally {
    filterGraph.cleanup();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function renderMedleyToFile(
  ffmpegPath: string,
  plan: MedleyExportPlan,
  outputPath: string,
  bitrateKbps: number,
  onProgress?: (progress: FfmpegProgress) => void
): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beatstride-medley-'));

  try {
    const renderedClips: MedleyRenderedClip[] = [];
    for (let i = 0; i < plan.clips.length; i += 1) {
      const clip = plan.clips[i];
      const singlePlan: SingleTrackExportPlan = {
        mode: 'single',
        projectFilePath: plan.projectFilePath,
        outputDir: tempDir,
        format: 'wav',
        normalizeLoudness: false,
        metronomeSamplePath: plan.metronomeSamplePath,
        renderOptions: plan.renderOptions,
        track: {
          ...clip.track,
          outputBaseName: `clip_${i.toString().padStart(3, '0')}`
        }
      };
      const clipPath = path.join(tempDir, `${singlePlan.track.outputBaseName}.wav`);
      await renderSingleToFile(ffmpegPath, singlePlan, clipPath, 320, (progress) => {
        if (!onProgress) {
          return;
        }
        const base = i / Math.max(1, plan.clips.length);
        const ratio = (base + progress.ratio / Math.max(1, plan.clips.length)) * 0.8;
        onProgress({ ...progress, ratio: Math.min(0.8, ratio) });
      });
      renderedClips.push({
        filePath: clipPath,
        startMs: clip.timelineStartMs,
        endMs: clip.timelineEndMs
      });
    }

    const inputFiles: string[] = [];
    if (!plan.clips.some((clip) => clip.transitionInMs > 0)) {
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
    const filterGraph = createFilterGraphArgs(graph, tempDir, 'medley-filter');

    args.push(
      ...filterGraph.args,
      '-map',
      outputLabel,
      ...buildOutputCodecArgs(plan.format, bitrateKbps),
      outputPath
    );

    try {
      await runFfmpeg(ffmpegPath, args, plan.durationMs, (progress) => {
        onProgress?.({
          ...progress,
          ratio: 0.8 + progress.ratio * 0.2
        });
      });
    } finally {
      filterGraph.cleanup();
    }
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
  const safeOutputBaseName = sanitizeFileName(plan.track.outputBaseName);
  const outputPath = path.join(outputDir, `${safeOutputBaseName}.${plan.format}`);
  await renderSingleToFile(
    ffmpegPath,
    plan,
    outputPath,
    options?.bitrateKbps ?? 320,
    options?.onProgress
  );
  return outputPath;
}

export async function renderSinglePreviewPayload(
  ffmpegPath: string,
  plan: SingleTrackExportPlan,
  mode: 'original' | 'processed' | 'metronome'
): Promise<PreparedPlaybackAudio> {
  const resolvedSource = resolveSinglePreviewSourcePlan(plan);
  const previewPlan = buildSinglePreviewPlan(resolvedSource.plan, mode);
  const outputPath = buildSinglePreviewCachePath(resolvedSource.plan, mode);

  if (resolvedSource.usedProxy) {
    console.info('[BeatStride][preview-source]', {
      mode: 'single',
      trackId: plan.track.trackId,
      source: 'project-proxy',
      filePath: resolvedSource.plan.track.sourceFilePath
    });
  }

  if (!fs.existsSync(outputPath)) {
    await renderSingleToFile(
      ffmpegPath,
      {
        ...previewPlan,
        format: 'mp3',
        normalizeLoudness: false
      },
      outputPath,
      PREVIEW_BITRATE_KBPS
    );
  }
  return createPreparedFilePayload(outputPath);
}

export async function renderMedleyPreviewPayload(
  ffmpegPath: string,
  plan: MedleyExportPlan,
  mode: 'processed' | 'metronome'
): Promise<PreparedPlaybackAudio> {
  const resolvedSource = resolveMedleyPreviewSourcePlan(plan);
  const previewPlan = buildMedleyPreviewPlan(resolvedSource.plan, mode);
  const outputPath = buildMedleyPreviewCachePath(resolvedSource.plan, mode);

  if (resolvedSource.usedProxyTrackCount > 0) {
    console.info('[BeatStride][preview-source]', {
      mode: 'medley',
      source: 'project-proxy',
      usedProxyTrackCount: resolvedSource.usedProxyTrackCount,
      totalTrackCount: plan.clips.length
    });
  }

  if (!fs.existsSync(outputPath)) {
    await renderMedleyToFile(
      ffmpegPath,
      {
        ...previewPlan,
        format: 'mp3',
        normalizeLoudness: false
      },
      outputPath,
      PREVIEW_BITRATE_KBPS
    );
  }
  return createPreparedFilePayload(outputPath);
}

export async function generateTrackProxies(
  ffmpegPath: string,
  plans: SingleTrackExportPlan[],
  options?: {
    bitrateKbps?: number;
  }
): Promise<GeneratedTrackProxy[]> {
  const results: GeneratedTrackProxy[] = [];

  for (const plan of plans) {
    if (!plan.projectFilePath) {
      throw new Error(`歌曲 ${plan.track.trackName} 所在项目尚未保存，无法生成代理文件。`);
    }
    const proxyDir = getProjectProxyDir(plan.projectFilePath);
    if (!proxyDir) {
      throw new Error(`无法确定歌曲 ${plan.track.trackName} 的代理目录。`);
    }
    ensureDir(proxyDir);
    const outputPath = buildProjectProxyPath(plan.projectFilePath, plan);
    cleanupStaleTrackProxies(plan.projectFilePath, plan.track.trackId, outputPath);

    let reused = false;
    if (!fs.existsSync(outputPath)) {
      await renderMaterialProxy(
        ffmpegPath,
        plan.track.sourceFilePath,
        outputPath,
        plan.track.trimmedSourceDurationMs + plan.track.trimInMs + plan.track.trimOutMs,
        options?.bitrateKbps ?? TRACK_PROXY_BITRATE_KBPS
      );
    } else {
      reused = true;
    }

    results.push({
      trackId: plan.track.trackId,
      filePath: outputPath,
      fileName: path.basename(outputPath),
      reused
    });
  }

  return results;
}

export function getTrackProxyStatuses(plans: SingleTrackExportPlan[]): TrackProxyStatusResult[] {
  return plans.map((plan) => {
    if (!plan.projectFilePath) {
      return {
        trackId: plan.track.trackId,
        status: 'missing'
      };
    }

    const readyPath = tryReuseProjectProxy(plan);
    if (readyPath) {
      return {
        trackId: plan.track.trackId,
        status: 'ready',
        filePath: readyPath
      };
    }

    if (hasAnyTrackProxy(plan.projectFilePath, plan.track.trackId)) {
      return {
        trackId: plan.track.trackId,
        status: 'stale'
      };
    }

    return {
      trackId: plan.track.trackId,
      status: 'missing'
    };
  });
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
  const outputPath = path.join(outputDir, `beatstride_medley.${plan.format}`);
  await renderMedleyToFile(
    ffmpegPath,
    plan,
    outputPath,
    options?.bitrateKbps ?? 320,
    options?.onProgress
  );
  return outputPath;
}
