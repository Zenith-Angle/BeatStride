import { create } from 'zustand';
import type { ProjectFile, Track } from '@shared/types';
import {
  buildProjectPreviewExportPlan,
  buildSingleTrackPreviewExportPlan,
  buildSingleTrackPreviewPlan
} from '@shared/services/previewPlanService';
import { useAppSettingsStore } from '@renderer/stores/appSettingsStore';

export type PreviewMode = 'original' | 'processed' | 'metronome';
export type PreviewTarget = 'single' | 'medley';
interface PlaybackStartOptions {
  startPreviewMs?: number;
}

interface PlaybackSegment {
  kind: 'track' | 'gap';
  label: string;
  trackId: string | null;
  previewDurationMs: number;
  sourceFilePath?: string;
  sourceStartSec?: number;
  sourceEndSec?: number;
  playbackRate?: number;
  beatTimesMs?: number[];
  beatAccents?: boolean[];
  beatGainValues?: number[];
  beatsPerBar?: number;
  metronomeSamplePath?: string;
  beatRenderMode?: ProjectFile['mixTuning']['beatRenderMode'];
  beatOriginalBpm?: number;
  metronomeBpm?: number;
  resolveTrackId?: (previewTimeMs: number) => string | null;
  resolveLabel?: (previewTimeMs: number) => string;
}

interface PlaybackState {
  mode: PreviewMode;
  target: PreviewTarget;
  isPlaying: boolean;
  playingTrackId: string | null;
  currentTimeMs: number;
  currentLabel: string;
  volume: number;
  lastError: string;
  debugLog: string[];
  setMode: (mode: PreviewMode) => void;
  setTarget: (target: PreviewTarget) => void;
  setVolume: (volume: number) => void;
  setPreviewPosition: (timeMs: number, label?: string, trackId?: string | null) => void;
  playTrack: (track: Track, project: ProjectFile, options?: PlaybackStartOptions) => Promise<void>;
  playMedley: (project: ProjectFile, options?: PlaybackStartOptions) => Promise<void>;
  stop: () => void;
}

let audio: HTMLAudioElement | null = null;
let context: AudioContext | null = null;
let currentMetronomeNodes: AudioScheduledSourceNode[] = [];
let frame: number | null = null;
let playbackToken = 0;
let playbackRequestToken = 0;
let activeBlobUrls: string[] = [];
const activeAudioElements = new Set<HTMLAudioElement>();
let masterGainNode: GainNode | null = null;
let previewVolume = 1;
const metronomeBufferCache = new Map<string, Promise<AudioBuffer | null>>();

function logPreviewDebug(scope: string, payload: Record<string, unknown>): void {
  console.info(`[BeatStride][${scope}]`, payload);
}

function pushDebug(
  set: (partial: Partial<PlaybackState> | ((state: PlaybackState) => Partial<PlaybackState>)) => void,
  message: string
): void {
  const entry = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${message}`;
  set((state) => ({
    debugLog: [...state.debugLog.slice(-29), entry]
  }));
}

function toPlayableSrc(filePath: string): string {
  if (/^(https?:|file:|blob:)/i.test(filePath)) {
    return filePath;
  }

  const normalized = filePath.replace(/\\/g, '/');
  const prefixed = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
  return encodeURI(prefixed);
}

function clearPreviewNodes(): void {
  currentMetronomeNodes.forEach((node) => {
    try {
      node.stop();
      node.disconnect();
    } catch {
      // ignore stop errors on already ended nodes
    }
  });
  currentMetronomeNodes = [];
}

function clearBlobUrls(): void {
  activeBlobUrls.forEach((url) => URL.revokeObjectURL(url));
  activeBlobUrls = [];
}

function stopAllAudioElements(): void {
  activeAudioElements.forEach((element) => {
    try {
      element.pause();
      element.src = '';
      element.load();
    } catch {
      // ignore stop failures on stale media nodes
    }
  });
  activeAudioElements.clear();
}

function createBlobUrlFromBase64(base64Data: string, mimeType: string): string {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  activeBlobUrls.push(url);
  return url;
}

function decodeBase64ToArrayBuffer(base64Data: string): ArrayBuffer {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function cancelPendingRequests(): void {
  playbackRequestToken += 1;
}

function stopActivePlayback(): void {
  playbackToken += 1;
  stopAllAudioElements();
  audio = null;
  clearPreviewNodes();
  clearBlobUrls();
  if (frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
}

function stopEverything(): void {
  cancelPendingRequests();
  stopActivePlayback();
}

async function ensureAudioContext(): Promise<AudioContext> {
  if (!context) {
    context = new AudioContext();
    masterGainNode = context.createGain();
    masterGainNode.gain.value = previewVolume;
    masterGainNode.connect(context.destination);
  }
  if (context.state === 'suspended') {
    await context.resume();
  }
  return context;
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 1;
  }
  return Math.max(0, Math.min(1, volume));
}

function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

function applyPreviewVolume(volume: number): void {
  previewVolume = clampVolume(volume);
  if (audio) {
    audio.volume = previewVolume;
  }
  if (masterGainNode) {
    masterGainNode.gain.value = previewVolume;
  }
}

async function loadMetronomeBuffer(samplePath?: string): Promise<AudioBuffer | null> {
  if (!samplePath) {
    logPreviewDebug('metronome-buffer', {
      samplePath: '',
      status: 'missing-path'
    });
    return null;
  }

  const cached = metronomeBufferCache.get(samplePath);
  if (cached) {
    return cached;
  }

  const task = (async () => {
    try {
      const audioContext = await ensureAudioContext();
      const payload = await window.beatStride.preparePlaybackAudio(samplePath);
      const decoded = decodeBase64ToArrayBuffer(payload.base64Data);
      const buffer = await audioContext.decodeAudioData(decoded.slice(0));
      logPreviewDebug('metronome-buffer', {
        samplePath,
        status: 'loaded',
        durationSec: Number(buffer.duration.toFixed(3)),
        channels: buffer.numberOfChannels,
        sampleRate: buffer.sampleRate
      });
      return buffer;
    } catch (error) {
      logPreviewDebug('metronome-buffer', {
        samplePath,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  })();

  metronomeBufferCache.set(samplePath, task);
  return task;
}

function createAccentFlags(beatCount: number, beatsPerBar = 4): boolean[] {
  return Array.from({ length: beatCount }, (_, index) =>
    beatsPerBar > 0 ? index % beatsPerBar === 0 : false
  );
}

function scheduleFallbackClick(
  audioContext: AudioContext,
  when: number,
  accented: boolean,
  gainLinear: number
): void {
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = 'square';
  osc.frequency.value = accented ? 1900 : 1500;
  gain.gain.value = gainLinear * (accented ? 0.18 : 0.12);
  osc.connect(gain);
  gain.connect(masterGainNode ?? audioContext.destination);
  osc.start(when);
  osc.stop(when + 0.03);
  currentMetronomeNodes.push(osc);
}

function scheduleSampledClick(
  audioContext: AudioContext,
  buffer: AudioBuffer,
  when: number,
  accented: boolean,
  playbackRate: number,
  gainLinear: number
): void {
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  source.buffer = buffer;
  source.playbackRate.value = Math.max(0.05, playbackRate);
  gain.gain.value = gainLinear * (accented ? 1.2 : 0.92);
  source.connect(gain);
  gain.connect(masterGainNode ?? audioContext.destination);
  source.start(when);
  currentMetronomeNodes.push(source);
}

function scheduleMetronome(
  segment: PlaybackSegment,
  startOffsetMs: number
): void {
  const beatTimesMs = segment.beatTimesMs ?? [];
  if (beatTimesMs.length === 0) {
    return;
  }

  void ensureAudioContext().then(async (audioContext) => {
    const sampleBuffer = await loadMetronomeBuffer(segment.metronomeSamplePath);
    const now = audioContext.currentTime + 0.02;
    const accentFlags =
      segment.beatAccents && segment.beatAccents.length === beatTimesMs.length
        ? segment.beatAccents
        : createAccentFlags(beatTimesMs.length, segment.beatsPerBar ?? 4);
    const beatGainValues =
      segment.beatGainValues && segment.beatGainValues.length === beatTimesMs.length
        ? segment.beatGainValues
        : Array.from({ length: beatTimesMs.length }, () => 1);
    const playbackRate =
      segment.beatRenderMode === 'stretched-file' &&
      (segment.beatOriginalBpm ?? 0) > 0 &&
      (segment.metronomeBpm ?? 0) > 0
        ? (segment.metronomeBpm ?? 1) / Math.max(0.01, segment.beatOriginalBpm ?? 1)
        : 1;

    logPreviewDebug('metronome-schedule', {
      label: segment.label,
      samplePath: segment.metronomeSamplePath ?? '',
      sampleLoaded: Boolean(sampleBuffer),
      beatRenderMode: segment.beatRenderMode ?? 'unknown',
      beatOriginalBpm: segment.beatOriginalBpm ?? null,
      metronomeBpm: segment.metronomeBpm ?? null,
      beatsPerBar: segment.beatsPerBar ?? null,
      beatCount: beatTimesMs.length,
      startOffsetMs,
      playbackRate: Number(playbackRate.toFixed(4)),
      firstBeatMs: beatTimesMs[0] ?? null,
      lastBeatMs: beatTimesMs.at(-1) ?? null,
      firstBeatGain:
        beatGainValues.length > 0 ? Number((beatGainValues[0] ?? 1).toFixed(4)) : null
    });

    beatTimesMs.forEach((beatMs, index) => {
      const relativeMs = beatMs - startOffsetMs;
      if (relativeMs < -50) {
        return;
      }
      const when = now + Math.max(0, relativeMs) / 1000;
      const accented = accentFlags[index] ?? false;
      const gainLinear = beatGainValues[index] ?? 1;
      if (sampleBuffer) {
        scheduleSampledClick(audioContext, sampleBuffer, when, accented, playbackRate, gainLinear);
        return;
      }
      scheduleFallbackClick(audioContext, when, accented, gainLinear);
    });
  });
}

function createRenderedSegment(options: {
  label: string;
  previewDurationMs: number;
  sourceFilePath: string;
  trackId?: string | null;
  beatTimesMs?: number[];
  beatAccents?: boolean[];
  beatGainValues?: number[];
  beatsPerBar?: number;
  metronomeSamplePath?: string;
  beatRenderMode?: ProjectFile['mixTuning']['beatRenderMode'];
  beatOriginalBpm?: number;
  metronomeBpm?: number;
  resolveTrackId?: (previewTimeMs: number) => string | null;
  resolveLabel?: (previewTimeMs: number) => string;
}): PlaybackSegment {
  return {
    kind: 'track',
    label: options.label,
    trackId: options.trackId ?? null,
    previewDurationMs: options.previewDurationMs,
    sourceFilePath: options.sourceFilePath,
    sourceStartSec: 0,
    sourceEndSec: options.previewDurationMs / 1000,
    playbackRate: 1,
    beatTimesMs: options.beatTimesMs ?? [],
    beatAccents: options.beatAccents ?? [],
    beatGainValues: options.beatGainValues ?? [],
    beatsPerBar: options.beatsPerBar ?? 4,
    metronomeSamplePath: options.metronomeSamplePath,
    beatRenderMode: options.beatRenderMode,
    beatOriginalBpm: options.beatOriginalBpm,
    metronomeBpm: options.metronomeBpm,
    resolveTrackId: options.resolveTrackId,
    resolveLabel: options.resolveLabel
  };
}

async function runTrackSegment(
  segment: PlaybackSegment,
  baseMs: number,
  token: number,
  startPreviewMs: number,
  set: (partial: Partial<PlaybackState> | ((state: PlaybackState) => Partial<PlaybackState>)) => void
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (!segment.sourceFilePath) {
      resolve();
      return;
    }

    const currentAudio = new Audio();
    audio = currentAudio;
    activeAudioElements.add(currentAudio);
    currentAudio.preload = 'auto';
    currentAudio.src = toPlayableSrc(segment.sourceFilePath);
    currentAudio.playbackRate = segment.playbackRate ?? 1;
    currentAudio.volume = previewVolume;
    pushDebug(set, `准备播放 ${segment.label} | ${currentAudio.src}`);

    const startOffsetMs = Math.max(0, Math.min(startPreviewMs, segment.previewDurationMs));
    let pendingSeek =
      (segment.sourceStartSec ?? 0) + (startOffsetMs * (segment.playbackRate ?? 1)) / 1000;
    const applySeek = () => {
      if (token !== playbackToken) {
        return;
      }
      try {
        currentAudio.currentTime = pendingSeek;
        pushDebug(set, `已定位到 ${pendingSeek.toFixed(2)}s`);
        pendingSeek = 0;
      } catch {
        // Ignore seek timing issues while metadata settles.
      }
    };

    const tick = () => {
      if (token !== playbackToken) {
        resolve();
        return;
      }
      const sourceProgressSec = Math.max(
        0,
        currentAudio.currentTime - (segment.sourceStartSec ?? 0)
      );
      const previewProgressMs = Math.min(
        segment.previewDurationMs,
        Math.round((sourceProgressSec / Math.max(0.0001, segment.playbackRate ?? 1)) * 1000)
      );
      const currentLabel = segment.resolveLabel?.(previewProgressMs) ?? segment.label;
      const playingTrackId = segment.resolveTrackId?.(previewProgressMs) ?? segment.trackId;
      set({
        isPlaying: true,
        playingTrackId,
        currentLabel,
        currentTimeMs: baseMs + previewProgressMs
      });

      if (currentAudio.currentTime >= (segment.sourceEndSec ?? 0)) {
        pushDebug(set, `播放结束 ${segment.label}`);
        currentAudio.pause();
        currentAudio.src = '';
        activeAudioElements.delete(currentAudio);
        if (audio === currentAudio) {
          audio = null;
        }
        clearPreviewNodes();
        resolve();
        return;
      }

      frame = requestAnimationFrame(tick);
    };

    currentAudio.onloadedmetadata = () => {
      applySeek();
      pushDebug(set, `元数据已加载 ${segment.label}`);
    };
    currentAudio.onplay = () => {
      scheduleMetronome(segment, startOffsetMs);
      frame = requestAnimationFrame(tick);
      pushDebug(set, `开始播放 ${segment.label}`);
    };

    currentAudio.onended = () => {
      activeAudioElements.delete(currentAudio);
      if (audio === currentAudio) {
        audio = null;
      }
      clearPreviewNodes();
      resolve();
    };
    currentAudio.onerror = () => {
      const mediaError = currentAudio.error;
      activeAudioElements.delete(currentAudio);
      if (audio === currentAudio) {
        audio = null;
      }
      reject(
        new Error(
          `无法试听文件：${segment.sourceFilePath}${
            mediaError ? ` (code=${mediaError.code})` : ''
          }`
        )
      );
    };

    applySeek();
    currentAudio.load();
    void currentAudio.play().catch((error) => {
      activeAudioElements.delete(currentAudio);
      if (audio === currentAudio) {
        audio = null;
      }
      reject(error);
    });
  });
}

async function runGapSegment(
  segment: PlaybackSegment,
  baseMs: number,
  token: number,
  startPreviewMs: number,
  set: (partial: Partial<PlaybackState> | ((state: PlaybackState) => Partial<PlaybackState>)) => void
): Promise<void> {
  await new Promise<void>((resolve) => {
    const elapsedOffsetMs = Math.max(0, Math.min(startPreviewMs, segment.previewDurationMs));
    const start = performance.now() - elapsedOffsetMs;

    const tick = () => {
      if (token !== playbackToken) {
        resolve();
        return;
      }
      const elapsedMs = Math.min(segment.previewDurationMs, Math.round(performance.now() - start));
      set({
        isPlaying: true,
        playingTrackId: null,
        currentLabel: '间隔',
        currentTimeMs: baseMs + elapsedMs
      });

      if (elapsedMs >= segment.previewDurationMs) {
        resolve();
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
  });
}

async function playSegments(
  segments: PlaybackSegment[],
  token: number,
  startPreviewMs: number,
  set: (partial: Partial<PlaybackState> | ((state: PlaybackState) => Partial<PlaybackState>)) => void
): Promise<void> {
  let baseMs = 0;

  for (const segment of segments) {
    if (token !== playbackToken) {
      return;
    }

    clearPreviewNodes();
    const segmentStartPreviewMs = Math.max(0, startPreviewMs - baseMs);
    if (segmentStartPreviewMs >= segment.previewDurationMs) {
      baseMs += segment.previewDurationMs;
      continue;
    }

    if (segment.kind === 'gap') {
      await runGapSegment(segment, baseMs, token, segmentStartPreviewMs, set);
      baseMs += segment.previewDurationMs;
      continue;
    }

    await runTrackSegment(segment, baseMs, token, segmentStartPreviewMs, set);
    baseMs += segment.previewDurationMs;
  }

  if (token === playbackToken) {
    stopEverything();
    set({
      isPlaying: false,
      playingTrackId: null,
      currentTimeMs: 0,
      currentLabel: ''
    });
  }
}

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  mode: 'processed',
  target: 'single',
  isPlaying: false,
  playingTrackId: null,
  currentTimeMs: 0,
  currentLabel: '',
  volume: 1,
  lastError: '',
  debugLog: [],
  setMode: (mode) => set({ mode }),
  setTarget: (target) => {
    const nextMode =
      target === 'medley' && get().mode === 'original' ? 'processed' : get().mode;
    set({ target, mode: nextMode });
  },
  setVolume: (volume) => {
    const nextVolume = clampVolume(volume);
    applyPreviewVolume(nextVolume);
    set({ volume: nextVolume });
  },
  setPreviewPosition: (timeMs, label = '', trackId = null) => {
    set({
      currentTimeMs: Math.max(0, Math.round(timeMs)),
      currentLabel: label,
      playingTrackId: trackId,
      isPlaying: false
    });
  },
  playTrack: async (track, project, options) => {
    const metronomeSamplePath =
      project.defaultMetronomeSamplePath ||
      useAppSettingsStore.getState().settings.defaultMetronomeSamplePath;
    const requestToken = playbackRequestToken + 1;
    playbackRequestToken = requestToken;
    const mode = get().mode;
    const startPreviewMs = Math.max(0, options?.startPreviewMs ?? 0);
    const trackPlan = buildSingleTrackPreviewPlan(track, project);
    const exportPlan = buildSingleTrackPreviewExportPlan(track, project);
    logPreviewDebug('single-preview-request', {
      trackId: track.id,
      trackName: track.name,
      mode,
      sourceBpm: track.sourceBpm,
      alignedTargetBpm: trackPlan.targetBpm,
      metronomeBpm: trackPlan.metronomeBpm,
      effectiveSourceBpm: trackPlan.effectiveSourceBpm,
      speedRatio: Number(trackPlan.speedRatio.toFixed(6)),
      metronomeSamplePath,
      beatRenderMode: project.mixTuning.beatRenderMode,
      beatGainDb: project.mixTuning.beatGainDb,
      trackMetronomeVolumeDb: track.metronomeVolumeDb,
      beatOriginalBpm: project.mixTuning.beatOriginalBpm,
      beatCount: trackPlan.beatTimesMs.length,
      startPreviewMs
    });
    pushDebug(
      set,
      `单曲试听触发 | mode=${mode} | track=${track.name} | start=${startPreviewMs}ms`
    );
    set({ lastError: '' });
    try {
      const previewPayloadTask = window.beatStride.prepareSinglePreviewAudio({
        plan: exportPlan,
        mode: mode === 'original' ? 'original' : 'processed'
      });
      const metronomeBufferTask =
        mode === 'metronome'
          ? loadMetronomeBuffer(metronomeSamplePath)
          : Promise.resolve(null);
      const [playbackPayload] = await Promise.all([previewPayloadTask, metronomeBufferTask]);
      if (requestToken !== playbackRequestToken) {
        return;
      }
      stopActivePlayback();
      const token = playbackToken;
      const playbackSourcePath = createBlobUrlFromBase64(
        playbackPayload.base64Data,
        playbackPayload.mimeType
      );
      const previewDurationMs =
        mode === 'original' ? trackPlan.trimmedSourceDurationMs : trackPlan.processedDurationMs;
      pushDebug(set, `预览音频已就绪 | ${playbackPayload.fileName}`);
      const beatGainLinear = dbToLinear(track.metronomeVolumeDb + project.mixTuning.beatGainDb);
      logPreviewDebug('single-preview-ready', {
        trackId: track.id,
        mode,
        previewFileName: playbackPayload.fileName,
        previewDurationMs,
        metronomeSamplePath,
        beatGainLinear: Number(beatGainLinear.toFixed(4))
      });
      const segments = [
        createRenderedSegment({
          label: track.name,
          trackId: track.id,
          previewDurationMs,
          sourceFilePath: playbackSourcePath,
          beatTimesMs: mode === 'metronome' ? trackPlan.beatTimesMs : [],
          beatAccents:
            mode === 'metronome'
              ? createAccentFlags(trackPlan.beatTimesMs.length, trackPlan.beatsPerBar)
              : [],
          beatGainValues:
            mode === 'metronome'
              ? Array.from({ length: trackPlan.beatTimesMs.length }, () => beatGainLinear)
              : [],
          beatsPerBar: trackPlan.beatsPerBar,
          metronomeSamplePath,
          beatRenderMode: project.mixTuning.beatRenderMode,
          beatOriginalBpm: project.mixTuning.beatOriginalBpm,
          metronomeBpm: trackPlan.metronomeBpm
        })
      ];
      await playSegments(segments, token, startPreviewMs, set);
    } catch (error) {
      if (requestToken !== playbackRequestToken) {
        return;
      }
      stopEverything();
      const message = error instanceof Error ? error.message : String(error);
      pushDebug(set, `单曲试听失败 | ${message}`);
      set({
        isPlaying: false,
        playingTrackId: null,
        currentTimeMs: 0,
        currentLabel: message,
        lastError: message
      });
    }
  },
  playMedley: async (project, options) => {
    const metronomeSamplePath =
      project.defaultMetronomeSamplePath ||
      useAppSettingsStore.getState().settings.defaultMetronomeSamplePath;
    const requestToken = playbackRequestToken + 1;
    playbackRequestToken = requestToken;
    const mode: 'processed' | 'metronome' =
      get().mode === 'metronome' ? 'metronome' : 'processed';
    const startPreviewMs = Math.max(0, options?.startPreviewMs ?? 0);
    const medleyPlan = buildProjectPreviewExportPlan(project);
    logPreviewDebug('medley-preview-request', {
      mode,
      clipCount: medleyPlan.clips.length,
      durationMs: medleyPlan.durationMs,
      metronomeSamplePath,
      beatRenderMode: project.mixTuning.beatRenderMode,
      beatGainDb: project.mixTuning.beatGainDb,
      beatOriginalBpm: project.mixTuning.beatOriginalBpm,
      startPreviewMs,
      clips: medleyPlan.clips.map((clip, index) => ({
        index,
        trackId: clip.track.trackId,
        trackName: clip.track.trackName,
        sourceBpm: clip.track.sourceBpm,
        targetBpm: clip.track.targetBpm,
        metronomeBpm: clip.track.metronomeBpm,
        effectiveSourceBpm: clip.track.effectiveSourceBpm,
        speedRatio: Number(clip.track.speedRatio.toFixed(6)),
        beatCount: clip.track.beatTimesMs.length,
        metronomeVolumeDb: clip.track.metronomeVolumeDb
      }))
    });
    pushDebug(
      set,
      `串烧试听触发 | mode=${mode} | tracks=${medleyPlan.clips.length} | start=${startPreviewMs}ms`
    );
    set({ lastError: '' });

    if (medleyPlan.clips.length === 0) {
      set({
        isPlaying: false,
        playingTrackId: null,
        currentTimeMs: 0,
        currentLabel: ''
      });
      return;
    }

    try {
      const previewPayloadTask = window.beatStride.prepareMedleyPreviewAudio({
        plan: medleyPlan,
        mode: 'processed'
      });
      const metronomeBufferTask =
        mode === 'metronome'
          ? loadMetronomeBuffer(metronomeSamplePath)
          : Promise.resolve(null);
      const [playbackPayload] = await Promise.all([previewPayloadTask, metronomeBufferTask]);
      if (requestToken !== playbackRequestToken) {
        return;
      }
      stopActivePlayback();
      const token = playbackToken;
      const playbackSourcePath = createBlobUrlFromBase64(
        playbackPayload.base64Data,
        playbackPayload.mimeType
      );
      pushDebug(set, `串烧预览音频已就绪 | ${playbackPayload.fileName}`);
      const medleyBeatTimes =
        mode === 'metronome'
          ? medleyPlan.clips.flatMap((clip) =>
              clip.track.beatTimesMs.map((beatMs) => clip.timelineStartMs + beatMs)
            )
          : [];
      const medleyBeatAccents =
        mode === 'metronome'
          ? medleyPlan.clips.flatMap((clip) =>
              createAccentFlags(clip.track.beatTimesMs.length, clip.track.beatsPerBar)
            )
          : [];
      const medleyBeatGainValues =
        mode === 'metronome'
          ? medleyPlan.clips.flatMap((clip) =>
              Array.from(
                { length: clip.track.beatTimesMs.length },
                () => dbToLinear(clip.track.metronomeVolumeDb + project.mixTuning.beatGainDb)
              )
            )
          : [];
      const segment = createRenderedSegment({
        label: '串烧试听',
        previewDurationMs: medleyPlan.durationMs,
        sourceFilePath: playbackSourcePath,
        beatTimesMs: medleyBeatTimes,
        beatAccents: medleyBeatAccents,
        beatGainValues: medleyBeatGainValues,
        beatsPerBar: project.mixTuning.beatsPerBar,
        metronomeSamplePath,
        beatRenderMode: project.mixTuning.beatRenderMode,
        beatOriginalBpm: project.mixTuning.beatOriginalBpm,
        metronomeBpm: project.globalTargetBpm,
        resolveTrackId: (previewTimeMs) =>
          medleyPlan.clips.find(
            (clip) =>
              previewTimeMs >= clip.timelineStartMs && previewTimeMs < clip.timelineEndMs
          )?.track.trackId ?? medleyPlan.clips.at(-1)?.track.trackId ?? null,
        resolveLabel: (previewTimeMs) => {
          const currentClip =
            medleyPlan.clips.find(
              (clip) =>
                previewTimeMs >= clip.timelineStartMs && previewTimeMs < clip.timelineEndMs
            ) ?? medleyPlan.clips.at(-1);
          if (!currentClip) {
            return '串烧试听';
          }
          const index = medleyPlan.clips.findIndex(
            (clip) => clip.track.trackId === currentClip.track.trackId
          );
          return `${index + 1}. ${currentClip.track.trackName}`;
        }
      });
      logPreviewDebug('medley-preview-ready', {
        mode,
        previewFileName: playbackPayload.fileName,
        durationMs: medleyPlan.durationMs,
        beatCount: medleyBeatTimes.length,
        metronomeSamplePath,
        firstBeatGain:
          medleyBeatGainValues.length > 0
            ? Number((medleyBeatGainValues[0] ?? 1).toFixed(4))
            : null
      });
      await playSegments([segment], token, startPreviewMs, set);
    } catch (error) {
      if (requestToken !== playbackRequestToken) {
        return;
      }
      stopEverything();
      const message = error instanceof Error ? error.message : String(error);
      pushDebug(set, `串烧试听失败 | ${message}`);
      set({
        isPlaying: false,
        playingTrackId: null,
        currentTimeMs: 0,
        currentLabel: message,
        lastError: message
      });
    }
  },
  stop: () => {
    stopEverything();
    pushDebug(set, '用户停止试听');
    set({ isPlaying: false, playingTrackId: null, currentTimeMs: 0, currentLabel: '' });
  }
}));
