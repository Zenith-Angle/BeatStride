import type {
  AppSettings,
  ExportPreset,
  LanguageCode,
  MixTuningSettings,
  ThemeMode
} from './types';

export const APP_NAME = 'BeatStride';
export const PROJECT_FILE_EXT = '.runbeat-project.json';
export const PROJECT_VERSION = 2;
export const PROJECT_PROXY_DIRNAME = 'beatstride-proxies';
export const MEDIA_PROTOCOL_SCHEME = 'beatstride-media';
export const LEGACY_DEFAULT_METRONOME_SAMPLE_PATH =
  'C:\\CodeProgram\\StrideBeat\\resources\\metronome\\180BPM.mp3';
export const DEFAULT_METRONOME_SAMPLE_PATH =
  'C:\\CodeProgram\\BeatStride\\resources\\metronome\\180BPM.mp3';

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

export const DEFAULT_MIX_TUNING: MixTuningSettings = {
  analysisSeconds: 120,
  beatGainDb: 0,
  beatOriginalBpm: 180,
  beatRenderMode: 'stretched-file',
  stretchEngine: 'auto',
  harmonicTolerance: 0.12,
  harmonicMappingEnabled: true,
  halfMapUpperBpm: 110,
  headroomDb: 1,
  beatsPerBar: 4,
  transitionBars: 2,
  transitionDuckDb: 4,
  loudnormEnabled: true,
  targetLufs: -14,
  targetLra: 10,
  targetTp: -1
};

export const DEFAULT_SETTINGS: AppSettings = {
  language: DEFAULT_LANGUAGE,
  theme: DEFAULT_THEME,
  defaultExportDir: '',
  defaultTargetBpm: 180,
  defaultFadeMs: 50,
  defaultMetronomeSamplePath: DEFAULT_METRONOME_SAMPLE_PATH,
  normalizeLoudnessByDefault: false,
  developerMode: false,
  ffmpeg: {
    ffmpegPath: '',
    ffprobePath: '',
    available: false,
    lastCheckedAt: ''
  },
  recentProjectPaths: []
};

export const DEFAULT_TIME_SIGNATURE = '4/4' as const;
export const DEFAULT_BEATS_PER_BAR = 4;
export const DEFAULT_ACCENT_PATTERN = [1.35, 1, 1, 1];

export const AUTO_SAVE_INTERVAL_MS = 4000;
export const WORKSPACE_TRACK_DRAG_MIME = 'application/x-beatstride-work-track';
