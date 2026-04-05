import { create } from 'zustand';
import type { PreparedPlaybackAudio, ProjectFile, Track } from '@shared/types';
import { MEDIA_PROTOCOL_SCHEME } from '@shared/constants';
import { buildBeatAccentValues } from '@shared/services/meterService';
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
  beatAccentValues?: number[];
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
  seekToPreviewPosition: (timeMs: number) => boolean;
  resolveMedleySeekFallbackMs: (requestedTimeMs: number) => number;
  pause: () => void;
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
let activePlaybackSegments: PlaybackSegment[] = [];
let pendingSeekCleanup: (() => void) | null = null;
let pendingSeekToken = 0;
let medleySeekFallbackEnabled = false;
let medleySeekFallbackMs = 0;

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
  if (new RegExp(`^(https?:|file:|blob:|${MEDIA_PROTOCOL_SCHEME}:)`, 'i').test(filePath)) {
    return filePath;
  }
  return `${MEDIA_PROTOCOL_SCHEME}://local/?path=${encodeURIComponent(filePath)}`;
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

async function createBlobUrlFromFilePath(filePath: string, mimeType: string): Promise<string> {
  const response = await fetch(toPlayableSrc(filePath));
  if (!response.ok) {
    throw new Error(`无法读取预览音频: ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || mimeType;
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
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

async function resolvePreparedAudioSource(payload: PreparedPlaybackAudio): Promise<string> {
  if (payload.filePath) {
    return createBlobUrlFromFilePath(payload.filePath, payload.mimeType);
  }
  if (payload.base64Data) {
    return createBlobUrlFromBase64(payload.base64Data, payload.mimeType);
  }
  throw new Error('预览音频数据为空，无法播放。');
}

function cancelPendingRequests(): void {
  playbackRequestToken += 1;
}

function clearPendingSeek(): void {
  if (!pendingSeekCleanup) {
    return;
  }
  pendingSeekCleanup();
  pendingSeekCleanup = null;
}

function stopActivePlayback(): void {
  playbackToken += 1;
  clearPendingSeek();
  stopAllAudioElements();
  audio = null;
  activePlaybackSegments = [];
  medleySeekFallbackEnabled = false;
  medleySeekFallbackMs = 0;
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

function resolveSegmentAtPreviewTime(
  segments: PlaybackSegment[],
  previewTimeMs: number
): { segment: PlaybackSegment; baseMs: number; offsetMs: number } | null {
  if (segments.length === 0) {
    return null;
  }

  let baseMs = 0;
  for (const segment of segments) {
    const segmentEndMs = baseMs + segment.previewDurationMs;
    if (previewTimeMs < segmentEndMs) {
      return {
        segment,
        baseMs,
        offsetMs: Math.max(0, previewTimeMs - baseMs)
      };
    }
    baseMs = segmentEndMs;
  }

  const lastSegment = segments.at(-1);
  if (!lastSegment) {
    return null;
  }
  return {
    segment: lastSegment,
    baseMs: Math.max(0, baseMs - lastSegment.previewDurationMs),
    offsetMs: lastSegment.previewDurationMs
  };
}

function seekActivePlayback(
  previewTimeMs: number,
  set: (partial: Partial<PlaybackState> | ((state: PlaybackState) => Partial<PlaybackState>)) => void
): boolean {
  const currentAudio = audio;
  const hasMetadata =
    currentAudio?.readyState !== undefined
      ? currentAudio.readyState >= HTMLMediaElement.HAVE_METADATA
      : false;
  logPreviewDebug('seek-active', {
    status: 'request',
    previewTimeMs,
    hasAudio: Boolean(currentAudio),
    activeSegmentCount: activePlaybackSegments.length,
    hasMetadata,
    audioPaused: currentAudio ? currentAudio.paused : null,
    audioSeeking: currentAudio ? currentAudio.seeking : null,
    audioReadyState: currentAudio ? currentAudio.readyState : null,
    audioCurrentTimeSec: currentAudio ? Number(currentAudio.currentTime.toFixed(4)) : null
  });
  if (!currentAudio || activePlaybackSegments.length === 0) {
    logPreviewDebug('seek-active', {
      status: 'failed-no-active-playback',
      previewTimeMs,
      hasAudio: Boolean(currentAudio),
      activeSegmentCount: activePlaybackSegments.length
    });
    return false;
  }
  if (!hasMetadata) {
    logPreviewDebug('seek-active', {
      status: 'failed-metadata-not-ready',
      previewTimeMs,
      audioReadyState: currentAudio.readyState
    });
    return false;
  }

  const resolved = resolveSegmentAtPreviewTime(activePlaybackSegments, previewTimeMs);
  if (!resolved) {
    logPreviewDebug('seek-active', {
      status: 'failed-resolve-segment',
      previewTimeMs,
      activeSegmentCount: activePlaybackSegments.length
    });
    return false;
  }
  if (resolved.segment.kind !== 'track') {
    logPreviewDebug('seek-active', {
      status: 'failed-non-track-segment',
      previewTimeMs,
      kind: resolved.segment.kind,
      label: resolved.segment.label
    });
    return false;
  }

  const nextOffsetMs = Math.max(0, Math.min(resolved.segment.previewDurationMs, resolved.offsetMs));
  const committedPreviewTimeMs = resolved.baseMs + nextOffsetMs;
  const nextCurrentTime =
    (resolved.segment.sourceStartSec ?? 0) +
    (nextOffsetMs * (resolved.segment.playbackRate ?? 1)) / 1000;
  const nextLabel = resolved.segment.resolveLabel?.(nextOffsetMs) ?? resolved.segment.label;
  const nextTrackId = resolved.segment.resolveTrackId?.(nextOffsetMs) ?? resolved.segment.trackId;
  logPreviewDebug('seek-active', {
    status: 'apply',
    previewTimeMs,
    baseMs: resolved.baseMs,
    offsetMs: resolved.offsetMs,
    nextOffsetMs,
    nextCurrentTimeSec: Number(nextCurrentTime.toFixed(4)),
    playbackRate: resolved.segment.playbackRate ?? 1,
    sourceStartSec: resolved.segment.sourceStartSec ?? 0,
    segmentDurationMs: resolved.segment.previewDurationMs,
    label: resolved.segment.label,
    trackId: resolved.segment.trackId
  });

  try {
    clearPendingSeek();
    clearPreviewNodes();
    currentAudio.playbackRate = resolved.segment.playbackRate ?? 1;
    const seekToken = ++pendingSeekToken;
    const finalizePendingSeek = (source: 'seeked' | 'timeupdate') => {
      if (seekToken !== pendingSeekToken || audio !== currentAudio) {
        return;
      }
      const committedAudioTimeSec = Number(currentAudio.currentTime.toFixed(4));
      const seekDeltaSec = Math.abs(currentAudio.currentTime - nextCurrentTime);
      if (seekDeltaSec > 0.25) {
        return;
      }
      clearPendingSeek();
      scheduleMetronome(resolved.segment, nextOffsetMs);
      logPreviewDebug('seek-active', {
        status: 'success-deferred',
        source,
        previewTimeMs,
        committedPreviewTimeMs,
        committedAudioTimeSec,
        seekDeltaSec: Number(seekDeltaSec.toFixed(4)),
        audioPaused: currentAudio.paused,
        audioSeeking: currentAudio.seeking,
        label: nextLabel,
        trackId: nextTrackId
      });
    };
    const handleSeeked = () => finalizePendingSeek('seeked');
    const handleTimeUpdate = () => finalizePendingSeek('timeupdate');
    const timeoutId = window.setTimeout(() => {
      if (seekToken !== pendingSeekToken) {
        return;
      }
      clearPendingSeek();
      logPreviewDebug('seek-active', {
        status: 'failed-deferred-timeout',
        previewTimeMs,
        committedPreviewTimeMs,
        nextCurrentTimeSec: Number(nextCurrentTime.toFixed(4)),
        committedAudioTimeSec: Number(currentAudio.currentTime.toFixed(4)),
        audioPaused: currentAudio.paused,
        audioSeeking: currentAudio.seeking
      });
    }, 1500);
    pendingSeekCleanup = () => {
      window.clearTimeout(timeoutId);
      currentAudio.removeEventListener('seeked', handleSeeked);
      currentAudio.removeEventListener('timeupdate', handleTimeUpdate);
    };
    currentAudio.addEventListener('seeked', handleSeeked);
    currentAudio.addEventListener('timeupdate', handleTimeUpdate);
    currentAudio.currentTime = nextCurrentTime;
    const committedAudioTimeSec = Number(currentAudio.currentTime.toFixed(4));
    const seekDeltaSec = Math.abs(currentAudio.currentTime - nextCurrentTime);
    const seekAccepted = seekDeltaSec <= 0.25;
    set({
      isPlaying: !currentAudio.paused,
      currentTimeMs: committedPreviewTimeMs,
      currentLabel: nextLabel,
      playingTrackId: nextTrackId
    });
    if (!seekAccepted) {
      pushDebug(
        set,
        `请求定位到 ${committedPreviewTimeMs.toFixed(0)}ms / audio=${nextCurrentTime.toFixed(2)}s`
      );
      logPreviewDebug('seek-active', {
        status: 'pending-commit',
        previewTimeMs,
        committedPreviewTimeMs,
        nextCurrentTimeSec: Number(nextCurrentTime.toFixed(4)),
        committedAudioTimeSec,
        seekDeltaSec: Number(seekDeltaSec.toFixed(4)),
        audioPaused: currentAudio.paused,
        audioSeeking: currentAudio.seeking,
        label: nextLabel,
        trackId: nextTrackId
      });
      return true;
    }
    clearPendingSeek();
    scheduleMetronome(resolved.segment, nextOffsetMs);
    pushDebug(
      set,
      `原地定位到 ${committedPreviewTimeMs.toFixed(0)}ms / audio=${nextCurrentTime.toFixed(2)}s`
    );
    logPreviewDebug('seek-active', {
      status: 'success',
      previewTimeMs,
      committedPreviewTimeMs,
      committedAudioTimeSec,
      seekDeltaSec: Number(seekDeltaSec.toFixed(4)),
      audioPaused: currentAudio.paused,
      audioSeeking: currentAudio.seeking,
      label: nextLabel,
      trackId: nextTrackId
    });
    return true;
  } catch (error) {
    clearPendingSeek();
    logPreviewDebug('seek-active', {
      status: 'failed-exception',
      previewTimeMs,
      nextCurrentTimeSec: Number(nextCurrentTime.toFixed(4)),
      playbackRate: resolved.segment.playbackRate ?? 1,
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
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
      let decoded: ArrayBuffer;
      if (payload.base64Data) {
        decoded = decodeBase64ToArrayBuffer(payload.base64Data);
      } else if (payload.filePath) {
        const response = await fetch(toPlayableSrc(payload.filePath));
        if (!response.ok) {
          throw new Error(`无法读取节拍器样本: ${response.status}`);
        }
        decoded = await response.arrayBuffer();
      } else {
        throw new Error('节拍器样本数据为空。');
      }
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

function createAccentValues(beatCount: number, accentPattern: number[] | undefined): number[] {
  return buildBeatAccentValues(beatCount, accentPattern);
}

function scheduleFallbackClick(
  audioContext: AudioContext,
  when: number,
  accentValue: number,
  gainLinear: number
): void {
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = 'square';
  osc.frequency.value = accentValue >= 1.25 ? 1900 : accentValue >= 1.08 ? 1700 : 1500;
  gain.gain.value = gainLinear * 0.12 * Math.max(0.75, Math.min(1.5, accentValue));
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
  accentValue: number,
  playbackRate: number,
  gainLinear: number
): void {
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  source.buffer = buffer;
  source.playbackRate.value = Math.max(0.05, playbackRate);
  gain.gain.value = gainLinear * Math.max(0.82, Math.min(1.45, accentValue));
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
    const accentValues =
      segment.beatAccentValues && segment.beatAccentValues.length === beatTimesMs.length
        ? segment.beatAccentValues
        : createAccentValues(beatTimesMs.length, undefined);
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
      const accentValue = accentValues[index] ?? 1;
      const gainLinear = beatGainValues[index] ?? 1;
      if (sampleBuffer) {
        scheduleSampledClick(audioContext, sampleBuffer, when, accentValue, playbackRate, gainLinear);
        return;
      }
      scheduleFallbackClick(audioContext, when, accentValue, gainLinear);
    });
  });
}

function createRenderedSegment(options: {
  label: string;
  previewDurationMs: number;
  sourceFilePath: string;
  trackId?: string | null;
  beatTimesMs?: number[];
  beatAccentValues?: number[];
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
    beatAccentValues: options.beatAccentValues ?? [],
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
      // Avoid forcing currentTime=0 on late metadata events, which may overwrite user seeks.
      if (pendingSeek <= 0.001) {
        pendingSeek = 0;
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

    const resolvePlaybackSnapshot = () => {
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
      return { previewProgressMs, currentLabel, playingTrackId };
    };

    const syncPlaybackSnapshot = (forceIsPlaying?: boolean) => {
      const snapshot = resolvePlaybackSnapshot();
      set({
        isPlaying: forceIsPlaying ?? !currentAudio.paused,
        playingTrackId: snapshot.playingTrackId,
        currentLabel: snapshot.currentLabel,
        currentTimeMs: baseMs + snapshot.previewProgressMs
      });
      return snapshot;
    };

    const tick = () => {
      if (token !== playbackToken) {
        resolve();
        return;
      }
      syncPlaybackSnapshot();

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
      if (token !== playbackToken) {
        return;
      }
      const snapshot = syncPlaybackSnapshot(true);
      scheduleMetronome(segment, snapshot.previewProgressMs);
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(tick);
      pushDebug(set, `开始播放 ${segment.label}`);
    };
    currentAudio.onpause = () => {
      if (token !== playbackToken) {
        return;
      }
      syncPlaybackSnapshot(false);
      clearPreviewNodes();
    };

    currentAudio.onended = () => {
      if (token === playbackToken) {
        set({
          isPlaying: false,
          playingTrackId: segment.trackId,
          currentLabel: segment.label,
          currentTimeMs: baseMs + segment.previewDurationMs
        });
      }
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
  activePlaybackSegments = segments;
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
  seekToPreviewPosition: (timeMs) => seekActivePlayback(Math.max(0, Math.round(timeMs)), set),
  resolveMedleySeekFallbackMs: (requestedTimeMs) => {
    const normalizedRequestedMs = Math.max(0, Math.round(requestedTimeMs));
    if (!medleySeekFallbackEnabled) {
      return normalizedRequestedMs;
    }
    const currentPositionMs = Math.max(0, Math.round(get().currentTimeMs));
    const latestLoadedMs = Math.max(currentPositionMs, Math.round(medleySeekFallbackMs));
    if (normalizedRequestedMs <= latestLoadedMs) {
      return normalizedRequestedMs;
    }
    return latestLoadedMs;
  },
  pause: () => {
    const { currentTimeMs, currentLabel, playingTrackId } = get();
    stopEverything();
    pushDebug(set, `用户暂停试听 | position=${currentTimeMs}ms`);
    set({
      isPlaying: false,
      playingTrackId,
      currentTimeMs,
      currentLabel
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
      const playbackSourcePath = await resolvePreparedAudioSource(playbackPayload);
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
          beatAccentValues:
            mode === 'metronome'
              ? createAccentValues(trackPlan.beatTimesMs.length, trackPlan.accentPattern)
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
    medleySeekFallbackEnabled = false;
    medleySeekFallbackMs = 0;
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

    if (medleyPlan.clips.some((clip) => clip.transitionInMs > 0)) {
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
        const playbackSourcePath = await resolvePreparedAudioSource(playbackPayload);
        pushDebug(set, `串烧预览音频已就绪 | ${playbackPayload.fileName}`);
        const medleyBeatTimes =
          mode === 'metronome'
            ? medleyPlan.clips.flatMap((clip) =>
                clip.track.beatTimesMs.map((beatMs) => clip.timelineStartMs + beatMs)
              )
            : [];
        const medleyBeatAccentValues =
          mode === 'metronome'
            ? medleyPlan.clips.flatMap((clip) =>
                createAccentValues(clip.track.beatTimesMs.length, clip.track.accentPattern)
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
          beatAccentValues: medleyBeatAccentValues,
          beatGainValues: medleyBeatGainValues,
          beatsPerBar: medleyPlan.clips[0]?.track.beatsPerBar ?? 4,
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
          strategy: 'full-render-crossfade',
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
      return;
    }

    type RuntimeMedleySegment =
      | {
          kind: 'gap';
          durationMs: number;
        }
      | {
          kind: 'track';
          durationMs: number;
          trackId: string;
          label: string;
          previewPlan: ReturnType<typeof buildSingleTrackPreviewExportPlan>;
          beatTimesMs: number[];
          beatAccentValues: number[];
          beatGainValues: number[];
          beatsPerBar: number;
          metronomeBpm: number;
        };

    const tracksById = new Map(project.tracks.map((track) => [track.id, track] as const));
    const runtimeSegments: RuntimeMedleySegment[] = [];
    let runtimeCursorMs = 0;

    medleyPlan.clips.forEach((clip, index) => {
      const sourceTrack = tracksById.get(clip.track.trackId);
      if (!sourceTrack) {
        return;
      }

      const clipStartMs = Math.max(0, Math.round(clip.timelineStartMs));
      if (clipStartMs > runtimeCursorMs) {
        runtimeSegments.push({
          kind: 'gap',
          durationMs: clipStartMs - runtimeCursorMs
        });
        runtimeCursorMs = clipStartMs;
      }

      const clipDurationMs = Math.max(0, Math.round(clip.track.processedDurationMs));
      if (clipDurationMs <= 0) {
        return;
      }

      const beatGainLinear = dbToLinear(clip.track.metronomeVolumeDb + project.mixTuning.beatGainDb);
      runtimeSegments.push({
        kind: 'track',
        durationMs: clipDurationMs,
        trackId: clip.track.trackId,
        label: `${index + 1}. ${clip.track.trackName}`,
        previewPlan: buildSingleTrackPreviewExportPlan(sourceTrack, project),
        beatTimesMs: clip.track.beatTimesMs,
        beatAccentValues: createAccentValues(
          clip.track.beatTimesMs.length,
          clip.track.accentPattern
        ),
        beatGainValues: Array.from({ length: clip.track.beatTimesMs.length }, () => beatGainLinear),
        beatsPerBar: clip.track.beatsPerBar,
        metronomeBpm: clip.track.metronomeBpm
      });
      runtimeCursorMs += clipDurationMs;
    });

    if (runtimeSegments.length === 0) {
      set({
        isPlaying: false,
        playingTrackId: null,
        currentTimeMs: 0,
        currentLabel: ''
      });
      return;
    }

    const runtimeDurationMs = runtimeSegments.reduce((sum, segment) => sum + segment.durationMs, 0);
    const runtimeSegmentStartMs: number[] = [];
    {
      let segmentCursorMs = 0;
      for (const segment of runtimeSegments) {
        runtimeSegmentStartMs.push(segmentCursorMs);
        segmentCursorMs += segment.durationMs;
      }
    }
    const normalizedStartMs = Math.max(0, Math.min(runtimeDurationMs, startPreviewMs));
    let startSegmentIndex = 0;
    let startOffsetInSegmentMs = normalizedStartMs;
    while (
      startSegmentIndex < runtimeSegments.length &&
      startOffsetInSegmentMs >= runtimeSegments[startSegmentIndex].durationMs
    ) {
      startOffsetInSegmentMs -= runtimeSegments[startSegmentIndex].durationMs;
      startSegmentIndex += 1;
    }

    const payloadTaskBySegmentIndex = new Map<number, Promise<PreparedPlaybackAudio>>();
    const ensureTrackPayloadTask = (
      segmentIndex: number
    ): Promise<PreparedPlaybackAudio> => {
      const existing = payloadTaskBySegmentIndex.get(segmentIndex);
      if (existing) {
        return existing;
      }
      const segment = runtimeSegments[segmentIndex];
      if (!segment || segment.kind !== 'track') {
        return Promise.reject(new Error(`非法串烧分段索引: ${segmentIndex}`));
      }
      const task = window.beatStride.prepareSinglePreviewAudio({
        plan: segment.previewPlan,
        mode: 'processed'
      });
      void task.then(() => {
        if (!medleySeekFallbackEnabled || requestToken !== playbackRequestToken) {
          return;
        }
        const segmentStartMs = runtimeSegmentStartMs[segmentIndex] ?? 0;
        const segmentEndMs = segmentStartMs + segment.durationMs;
        medleySeekFallbackMs = Math.max(medleySeekFallbackMs, Math.max(0, segmentEndMs - 1));
      });
      payloadTaskBySegmentIndex.set(segmentIndex, task);
      return task;
    };
    const prewarmNextTrackPayload = (fromIndex: number): void => {
      for (let index = fromIndex; index < runtimeSegments.length; index += 1) {
        const segment = runtimeSegments[index];
        if (segment.kind !== 'track') {
          continue;
        }
        ensureTrackPayloadTask(index);
        return;
      }
    };

    try {
      const metronomeBufferTask =
        mode === 'metronome'
          ? loadMetronomeBuffer(metronomeSamplePath)
          : Promise.resolve(null);
      prewarmNextTrackPayload(startSegmentIndex);
      await metronomeBufferTask;
      if (requestToken !== playbackRequestToken) {
        return;
      }

      stopActivePlayback();
      medleySeekFallbackEnabled = true;
      medleySeekFallbackMs = Math.max(0, normalizedStartMs);
      activePlaybackSegments = [];
      const token = playbackToken;
      logPreviewDebug('medley-preview-ready', {
        mode,
        strategy: 'segmented-stream',
        segmentCount: runtimeSegments.length,
        durationMs: runtimeDurationMs,
        metronomeSamplePath
      });

      let baseMs = runtimeSegments
        .slice(0, startSegmentIndex)
        .reduce((sum, segment) => sum + segment.durationMs, 0);

      for (let index = startSegmentIndex; index < runtimeSegments.length; index += 1) {
        if (token !== playbackToken) {
          return;
        }
        const segment = runtimeSegments[index];
        const startOffsetMs = index === startSegmentIndex ? startOffsetInSegmentMs : 0;

        if (segment.kind === 'gap') {
          await runGapSegment(
            {
              kind: 'gap',
              label: '间隔',
              trackId: null,
              previewDurationMs: segment.durationMs
            },
            baseMs,
            token,
            startOffsetMs,
            set
          );
          baseMs += segment.durationMs;
          continue;
        }

        const payloadTask = ensureTrackPayloadTask(index);
        prewarmNextTrackPayload(index + 1);
        const playbackPayload = await payloadTask;
        if (token !== playbackToken) {
          return;
        }
        const playbackSourcePath = await resolvePreparedAudioSource(playbackPayload);
        pushDebug(set, `串烧分段就绪 | ${segment.label}`);
        await runTrackSegment(
          createRenderedSegment({
            label: segment.label,
              trackId: segment.trackId,
              previewDurationMs: segment.durationMs,
              sourceFilePath: playbackSourcePath,
              beatTimesMs: mode === 'metronome' ? segment.beatTimesMs : [],
              beatAccentValues: mode === 'metronome' ? segment.beatAccentValues : [],
              beatGainValues: mode === 'metronome' ? segment.beatGainValues : [],
              beatsPerBar: segment.beatsPerBar,
            metronomeSamplePath,
            beatRenderMode: project.mixTuning.beatRenderMode,
            beatOriginalBpm: project.mixTuning.beatOriginalBpm,
            metronomeBpm: segment.metronomeBpm
          }),
          baseMs,
          token,
          startOffsetMs,
          set
        );
        baseMs += segment.durationMs;
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
