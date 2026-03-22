import { create } from 'zustand';
import type { Track, TrackRenderPlan } from '@shared/types';

export type PreviewMode = 'original' | 'processed' | 'metronome';

interface PlaybackState {
  mode: PreviewMode;
  isPlaying: boolean;
  playingTrackId: string | null;
  currentTimeMs: number;
  setMode: (mode: PreviewMode) => void;
  playTrack: (track: Track, plan: TrackRenderPlan) => Promise<void>;
  stop: () => void;
}

let audio: HTMLAudioElement | null = null;
let context: AudioContext | null = null;
let currentOscillators: OscillatorNode[] = [];
let frame: number | null = null;

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

function scheduleMetronome(plan: TrackRenderPlan, mode: PreviewMode): void {
  if (mode !== 'metronome') {
    return;
  }
  if (!context) {
    context = new AudioContext();
  }
  const now = context.currentTime;
  for (const beatMs of plan.beatTimesMs) {
    const when = now + beatMs / 1000;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'square';
    osc.frequency.value = 1600;
    gain.gain.value = 0.16;
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(when);
    osc.stop(when + 0.03);
    currentOscillators.push(osc);
  }
}

function stopEverything(): void {
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

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  mode: 'original',
  isPlaying: false,
  playingTrackId: null,
  currentTimeMs: 0,
  setMode: (mode) => set({ mode }),
  playTrack: async (track, plan) => {
    stopEverything();
    const mode = get().mode;
    audio = new Audio(track.filePath);
    audio.playbackRate = mode === 'original' ? 1 : plan.speedRatio;
    audio.currentTime = plan.trimInMs / 1000;
    audio.volume = 1;
    await audio.play();
    scheduleMetronome(plan, mode);
    set({
      isPlaying: true,
      playingTrackId: track.id,
      currentTimeMs: Math.round(audio.currentTime * 1000)
    });
    const tick = () => {
      if (!audio) {
        return;
      }
      set({ currentTimeMs: Math.round(audio.currentTime * 1000) });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    audio.onended = () => {
      stopEverything();
      set({ isPlaying: false, playingTrackId: null });
    };
  },
  stop: () => {
    stopEverything();
    set({ isPlaying: false, playingTrackId: null, currentTimeMs: 0 });
  }
}));
