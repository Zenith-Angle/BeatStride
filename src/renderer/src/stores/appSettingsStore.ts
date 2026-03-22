import { create } from 'zustand';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { AppSettings, LanguageCode, ThemeMode } from '@shared/types';

interface AppSettingsState {
  settings: AppSettings;
  loading: boolean;
  loadSettings: () => Promise<void>;
  setLanguage: (language: LanguageCode) => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>;
  checkFfmpeg: () => Promise<void>;
}

export const useAppSettingsStore = create<AppSettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loading: false,
  loadSettings: async () => {
    set({ loading: true });
    const settings = await window.beatStride.getSettings();
    set({ settings, loading: false });
  },
  setLanguage: async (language) => {
    const next = await window.beatStride.saveSettings({ language });
    set({ settings: next });
  },
  setTheme: async (theme) => {
    const next = await window.beatStride.saveSettings({ theme });
    set({ settings: next });
  },
  patchSettings: async (patch) => {
    const next = await window.beatStride.saveSettings({
      ...get().settings,
      ...patch
    });
    set({ settings: next });
  },
  checkFfmpeg: async () => {
    const ffmpeg = await window.beatStride.checkFfmpeg({
      ffmpegPath: get().settings.ffmpeg.ffmpegPath,
      ffprobePath: get().settings.ffmpeg.ffprobePath
    });
    set((state) => ({
      settings: {
        ...state.settings,
        ffmpeg
      }
    }));
  }
}));
