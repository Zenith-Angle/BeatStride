export type ThemeMode = 'system' | 'light' | 'dark';
export type LanguageCode = 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP' | 'fr-FR';
export type ExportMode = 'single' | 'medley';
export type TimeSignature = '4/4';
export type ExportFormat = 'wav' | 'mp3';
export type StretchEngine = 'auto' | 'rubberband' | 'atempo';
export type ResolvedStretchEngine = 'rubberband' | 'atempo';
export type BeatRenderMode = 'crisp-click' | 'sampled-click' | 'stretched-file';

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

export interface MixTuningSettings {
  analysisSeconds: number;
  beatGainDb: number;
  beatOriginalBpm: number;
  beatRenderMode: BeatRenderMode;
  stretchEngine: StretchEngine;
  harmonicTolerance: number;
  harmonicMappingEnabled: boolean;
  halfMapUpperBpm: number;
  headroomDb: number;
  beatsPerBar: number;
  transitionBars: number;
  transitionDuckDb: number;
  loudnormEnabled: boolean;
  targetLufs: number;
  targetLra: number;
  targetTp: number;
}

export interface AppSettings {
  language: LanguageCode;
  theme: ThemeMode;
  defaultExportDir: string;
  defaultTargetBpm: number;
  defaultFadeMs: number;
  defaultMetronomeSamplePath: string;
  normalizeLoudnessByDefault: boolean;
  developerMode: boolean;
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
  mixTuning: MixTuningSettings;
}

export interface TrackRenderPlan {
  trackId: string;
  trackName: string;
  sourceFilePath: string;
  outputBaseName: string;
  sourceBpm: number;
  effectiveSourceBpm: number;
  targetBpm: number;
  metronomeBpm: number;
  speedRatio: number;
  trimmedSourceDurationMs: number;
  processedDurationMs: number;
  downbeatOffsetMsAfterSpeed: number;
  metronomeStartMs: number;
  beatTimesMs: number[];
  beatsPerBar: number;
  harmonicMode: string;
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
  projectFilePath?: string;
  outputDir: string;
  format: ExportFormat;
  normalizeLoudness: boolean;
  metronomeSamplePath: string;
  renderOptions: ProjectRenderOptions;
  track: TrackRenderPlan;
}

export interface MedleyClipPlan {
  track: TrackRenderPlan;
  timelineStartMs: number;
  timelineEndMs: number;
}

export interface MedleyExportPlan {
  mode: 'medley';
  projectFilePath?: string;
  outputDir: string;
  format: ExportFormat;
  normalizeLoudness: boolean;
  gapMs: number;
  crossfadeMs: number;
  transitionDuckDb: number;
  metronomeSamplePath: string;
  renderOptions: ProjectRenderOptions;
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

export interface TempoAnalysisResult {
  bpm: number;
  confidence: number;
}

export interface PreparedPlaybackAudio {
  mimeType: string;
  fileName: string;
  base64Data: string;
}

export interface GeneratedTrackProxy {
  trackId: string;
  filePath: string;
  fileName: string;
  reused: boolean;
}

export type TrackProxyStatus = 'missing' | 'ready' | 'stale' | 'generating';

export interface TrackProxyStatusResult {
  trackId: string;
  status: TrackProxyStatus;
  filePath?: string;
}

export interface ExportSuffixRules {
  includeBpm: boolean;
  includeMetronomeTag: boolean;
  customSuffix: string;
}

export interface AlignmentSettings {
  globalTargetBpm: number;
  harmonicTolerance?: number;
  harmonicMappingEnabled?: boolean;
  halfMapUpperBpm?: number;
}

export interface ExportBuildSettings {
  globalTargetBpm: number;
  outputDir: string;
  format: ExportFormat;
  metronomeSamplePath: string;
  normalizeLoudness: boolean;
  projectFilePath?: string;
  gapMs?: number;
  crossfadeMs?: number;
  mixTuning: MixTuningSettings;
  transitionDuckDb?: number;
}

export interface ProjectRenderOptions {
  beatGainDb: number;
  beatOriginalBpm: number;
  beatRenderMode: BeatRenderMode;
  stretchEngine: StretchEngine;
  resolvedStretchEngine?: ResolvedStretchEngine;
  headroomDb: number;
  beatsPerBar: number;
  targetLufs: number;
  targetLra: number;
  targetTp: number;
}
