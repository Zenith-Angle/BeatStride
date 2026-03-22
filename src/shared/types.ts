export type ThemeMode = 'system' | 'light' | 'dark';
export type LanguageCode = 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP' | 'fr-FR';
export type ExportMode = 'single' | 'medley';
export type TimeSignature = '4/4';
export type ExportFormat = 'wav' | 'mp3';

export interface FfmpegBinaryConfig {
  ffmpegPath: string;
  ffprobePath: string;
  available: boolean;
  lastCheckedAt: string;
  message?: string;
}

export interface ExportPreset {
  mode: ExportMode;
  format: ExportFormat;
  sampleRate: number;
  bitrateKbps: number;
  outputDir: string;
  fileSuffix: string;
  normalizeLoudness: boolean;
  gapMs: number;
  crossfadeMs: number;
}

export interface AppSettings {
  language: LanguageCode;
  theme: ThemeMode;
  defaultExportDir: string;
  defaultTargetBpm: number;
  defaultFadeMs: number;
  defaultMetronomeSamplePath: string;
  normalizeLoudnessByDefault: boolean;
  ffmpeg: FfmpegBinaryConfig;
  recentProjectPaths: string[];
}

export interface TrackAlignment {
  sourceBpm: number;
  targetBpm: number;
  speedRatio: number;
  downbeatOffsetMs: number;
  metronomeOffsetMs: number;
}

export interface TrackExportSettings {
  format: ExportFormat;
  exportEnabled: boolean;
  metronomeEnabled: boolean;
  metronomeVolumeDb: number;
  volumeDb: number;
  pan: number;
  trimInMs: number;
  trimOutMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  normalizeLoudness: boolean;
}

export interface Track {
  id: string;
  name: string;
  filePath: string;
  durationMs: number;
  sampleRate: number;
  channels: number;
  detectedBpm?: number;
  sourceBpm: number;
  targetBpm?: number;
  speedRatio: number;
  downbeatOffsetMs: number;
  metronomeOffsetMs: number;
  trackStartMs: number;
  trimInMs: number;
  trimOutMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  volumeDb: number;
  pan: number;
  metronomeEnabled: boolean;
  metronomeVolumeDb: number;
  exportEnabled: boolean;
  inTimeline: boolean;
}

export interface TimelineClip {
  id: string;
  trackId: string;
  startMs: number;
  durationMs: number;
}

export interface ProjectMeta {
  id: string;
  name: string;
  filePath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFile {
  version: number;
  meta: ProjectMeta;
  globalTargetBpm: number;
  timeSignature: TimeSignature;
  defaultMetronomeSamplePath: string;
  theme: ThemeMode;
  language: LanguageCode;
  tracks: Track[];
  exportPreset: ExportPreset;
}

export interface TrackRenderPlan {
  trackId: string;
  trackName: string;
  sourceFilePath: string;
  outputBaseName: string;
  sourceBpm: number;
  targetBpm: number;
  speedRatio: number;
  trimmedSourceDurationMs: number;
  processedDurationMs: number;
  downbeatOffsetMsAfterSpeed: number;
  metronomeStartMs: number;
  beatTimesMs: number[];
  trackStartMs: number;
  trimInMs: number;
  trimOutMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  volumeDb: number;
  pan: number;
  metronomeEnabled: boolean;
  metronomeVolumeDb: number;
}

export interface SingleTrackExportPlan {
  mode: 'single';
  outputDir: string;
  format: ExportFormat;
  normalizeLoudness: boolean;
  metronomeSamplePath: string;
  track: TrackRenderPlan;
}

export interface MedleyClipPlan {
  track: TrackRenderPlan;
  timelineStartMs: number;
  timelineEndMs: number;
}

export interface MedleyExportPlan {
  mode: 'medley';
  outputDir: string;
  format: ExportFormat;
  normalizeLoudness: boolean;
  gapMs: number;
  crossfadeMs: number;
  metronomeSamplePath: string;
  clips: MedleyClipPlan[];
  durationMs: number;
}

export interface ExportJob {
  id: string;
  mode: ExportMode;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  startedAt?: string;
  endedAt?: string;
  outputPath?: string;
  error?: string;
}

export interface AudioProbeInfo {
  durationMs: number;
  sampleRate: number;
  channels: number;
  formatName: string;
  bitRate?: number;
}

export interface ExportSuffixRules {
  includeBpm: boolean;
  includeMetronomeTag: boolean;
  customSuffix: string;
}

export interface AlignmentSettings {
  globalTargetBpm: number;
}

export interface ExportBuildSettings {
  outputDir: string;
  format: ExportFormat;
  metronomeSamplePath: string;
  normalizeLoudness: boolean;
  gapMs?: number;
  crossfadeMs?: number;
}
