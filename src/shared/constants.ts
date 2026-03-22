import type { AppSettings, ExportPreset, LanguageCode, ThemeMode } from './types';

export const APP_NAME = 'BeatStride';
export const PROJECT_FILE_EXT = '.runbeat-project.json';
export const PROJECT_VERSION = 1;

export const SUPPORTED_IMPORT_EXT = ['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg'];
export const SUPPORTED_EXPORT_FORMATS = ['wav', 'mp3'] as const;

export const DEFAULT_LANGUAGE: LanguageCode = 'zh-CN';
export const DEFAULT_THEME: ThemeMode = 'light';

export const DEFAULT_EXPORT_PRESET: ExportPreset = {
  mode: 'single',
  format: 'wav',
  sampleRate: 48000,
  bitrateKbps: 320,
  outputDir: '',
  fileSuffix: '__mix',
  normalizeLoudness: false,
  gapMs: 0,
  crossfadeMs: 0
};

export const DEFAULT_SETTINGS: AppSettings = {
  language: DEFAULT_LANGUAGE,
  theme: DEFAULT_THEME,
  defaultExportDir: '',
  defaultTargetBpm: 180,
  defaultFadeMs: 50,
  defaultMetronomeSamplePath: '',
  normalizeLoudnessByDefault: false,
  ffmpeg: {
    ffmpegPath: '',
    ffprobePath: '',
    available: false,
    lastCheckedAt: ''
  },
  recentProjectPaths: []
};

export const DEFAULT_TIME_SIGNATURE = '4/4' as const;

export const AUTO_SAVE_INTERVAL_MS = 4000;
