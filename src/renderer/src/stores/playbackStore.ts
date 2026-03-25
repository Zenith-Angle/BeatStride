import { create } from 'zustand';
import type { ProjectFile, Track, TrackRenderPlan } from '@shared/types';
import {
  buildProjectPreviewPlan,
  buildSingleTrackPreviewPlan
} from '@shared/services/previewPlanService';

export type PreviewMode = 'original' | 'processed' | 'metronome';
export type PreviewTarget = 'single' | 'medley';

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
}

interface PlaybackState {
  mode: PreviewMode;
  target: PreviewTarget;
  isPlaying: boolean;
  playingTrackId: string | null;
  currentTimeMs: number;
  currentLabel: string;
  setMode: (mode: PreviewMode) => void;
  setTarget: (target: PreviewTarget) => void;
  playTrack: (track: Track, project: ProjectFile) => Promise<void>;
  playMedley: (project: ProjectFile) => Promise<void>;
  stop: () => void;
}

let audio: HTMLAudioElement | null = null;
let context: AudioContext | null = null;
let currentOscillators: OscillatorNode[] = [];
let frame: number | null = null;
let playbackToken = 0;

function clearPreviewNodes(): void {
  currentOscillators.forEach((osc) => {
    try {
      osc.stop();
      osc.disconnect();
    } catch {
      // ignore stop errors on already ended nodes
    }
  });
  currentOscillators = [];
}

function stopEverything(): void {
  playbackToken += 1;
  if (audio) {
    audio.pause();
    audio.src = '';
    audio = null;
  }
  clearPreviewNodes();
  if (frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
}

async function ensureAudioContext(): Promise<AudioContext> {
  if (!context) {
    context = new AudioContext();
  }
  if (context.state === 'suspended') {
    await context.resume();
  }
  return context;
}

function scheduleMetronome(beatTimesMs: number[], enabled: boolean): void {
  if (!enabled || beatTimesMs.length === 0) {
    return;
  }
  void ensureAudioContext().then((audioContext) => {
    const now = audioContext.currentTime;
    for (const beatMs of beatTimesMs) {
      const when = now + beatMs / 1000;
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'square';
      osc.frequency.value = 1600;
      gain.gain.value = 0.14;
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start(when);
      osc.stop(when + 0.03);
      currentOscillators.push(osc);
    }
  });
}

function createTrackSegment(
  plan: TrackRenderPlan,
  mode: PreviewMode,
  labelPrefix = ''
): PlaybackSegment {
  const playbackRate = mode === 'original' ? 1 : plan.speedRatio;
  const previewDurationMs =
    mode === 'original' ? plan.trimmedSourceDurationMs : plan.processedDurationMs;

  return {
    kind: 'track',
    label: `${labelPrefix}${plan.trackName}`,
    trackId: plan.trackId,
    previewDurationMs: Math.max(0, Math.round(previewDurationMs)),
    sourceFilePath: plan.sourceFilePath,
    sourceStartSec: plan.trimInMs / 1000,
    sourceEndSec: (plan.trimInMs + plan.trimmedSourceDurationMs) / 1000,
    playbackRate,
    beatTimesMs: mode === 'metronome' ? plan.beatTimesMs : []
  };
}

function createGapSegment(index: number, durationMs: number): PlaybackSegment {
  return {
    kind: 'gap',
    label: `Gap ${index + 1}`,
    trackId: null,
    previewDurationMs: durationMs
  };
}

async function runTrackSegment(
  segment: PlaybackSegment,
  baseMs: number,
  token: number,
  set: (partial: Partial<PlaybackState>) => void
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (!segment.sourceFilePath) {
      resolve();
      return;
    }

    audio = new Audio(segment.sourceFilePath);
    audio.playbackRate = segment.playbackRate ?? 1;
    audio.currentTime = segment.sourceStartSec ?? 0;
    audio.volume = 1;
    scheduleMetronome(segment.beatTimesMs ?? [], (segment.beatTimesMs?.length ?? 0) > 0);

    const tick = () => {
      if (token !== playbackToken || !audio) {
        resolve();
        return;
      }
      const sourceProgressSec = Math.max(0, audio.currentTime - (segment.sourceStartSec ?? 0));
      const previewProgressMs = Math.min(
        segment.previewDurationMs,
        Math.round((sourceProgressSec / Math.max(0.0001, segment.playbackRate ?? 1)) * 1000)
      );
      set({
        isPlaying: true,
        playingTrackId: segment.trackId,
        currentLabel: segment.label,
        currentTimeMs: baseMs + previewProgressMs
      });

      if (audio.currentTime >= (segment.sourceEndSec ?? 0)) {
        audio.pause();
        audio.src = '';
        audio = null;
        clearPreviewNodes();
        resolve();
        return;
      }

      frame = requestAnimationFrame(tick);
    };

    audio.onended = () => {
      clearPreviewNodes();
      resolve();
    };
    audio.onerror = () => reject(new Error(`无法试听文件：${segment.sourceFilePath}`));

    void audio
      .play()
      .then(() => {
        frame = requestAnimationFrame(tick);
      })
      .catch(reject);
  });
}

async function runGapSegment(
  segment: PlaybackSegment,
  baseMs: number,
  token: number,
  set: (partial: Partial<PlaybackState>) => void
): Promise<void> {
  await new Promise<void>((resolve) => {
    const start = performance.now();

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
  set: (partial: Partial<PlaybackState>) => void
): Promise<void> {
  let baseMs = 0;

  for (const segment of segments) {
    if (token !== playbackToken) {
      return;
    }

    clearPreviewNodes();

    if (segment.kind === 'gap') {
      await runGapSegment(segment, baseMs, token, set);
      baseMs += segment.previewDurationMs;
      continue;
    }

    await runTrackSegment(segment, baseMs, token, set);
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
  setMode: (mode) => set({ mode }),
  setTarget: (target) => {
    const nextMode =
      target === 'medley' && get().mode === 'original' ? 'processed' : get().mode;
    set({ target, mode: nextMode });
  },
  playTrack: async (track, project) => {
    stopEverything();
    const token = playbackToken;
    const mode = get().mode;
    const plan = buildSingleTrackPreviewPlan(track, project);
    const segments = [createTrackSegment(plan, mode)];
    try {
      await playSegments(segments, token, set);
    } catch (error) {
      stopEverything();
      set({
        isPlaying: false,
        playingTrackId: null,
        currentTimeMs: 0,
        currentLabel: error instanceof Error ? error.message : String(error)
      });
    }
  },
  playMedley: async (project) => {
    stopEverything();
    const token = playbackToken;
    const mode = get().mode === 'original' ? 'processed' : get().mode;
    const plans = buildProjectPreviewPlan(project);
    const enabledTracks = project.tracks.filter((track) => track.exportEnabled);
    const gapMs = Math.max(0, project.exportPreset.gapMs);
    const segments: PlaybackSegment[] = [];

    plans.forEach((plan, index) => {
      const included = enabledTracks.some((track) => track.id === plan.trackId);
      if (!included) {
        return;
      }
      segments.push(createTrackSegment(plan, mode, `${index + 1}. `));
      if (gapMs > 0 && index < plans.length - 1) {
        segments.push(createGapSegment(index, gapMs));
      }
    });

    if (segments.length === 0) {
      set({
        isPlaying: false,
        playingTrackId: null,
        currentTimeMs: 0,
        currentLabel: ''
      });
      return;
    }

    try {
      await playSegments(segments, token, set);
    } catch (error) {
      stopEverything();
      set({
        isPlaying: false,
        playingTrackId: null,
        currentTimeMs: 0,
        currentLabel: error instanceof Error ? error.message : String(error)
      });
    }
  },
  stop: () => {
    stopEverything();
    set({ isPlaying: false, playingTrackId: null, currentTimeMs: 0, currentLabel: '' });
  }
}));
