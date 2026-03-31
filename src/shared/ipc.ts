import type {
  AppSettings,
  AudioProbeInfo,
  FfmpegBinaryConfig,
  GeneratedTrackProxy,
  MedleyExportPlan,
  PreparedPlaybackAudio,
  ProjectFile,
  SingleTrackExportPlan,
  TrackProxyStatusResult,
  TempoAnalysisResult
} from './types';

export interface ExportProgressPayload {
  id: string;
  mode: 'single' | 'medley';
  progress: number;
  timeMs: number;
}

export type MenuActionPayload =
  | 'project:new'
  | 'project:open'
  | 'project:save'
  | 'project:saveAs'
  | `about:${string}`;

export interface BeatStrideApi {
  getSettings(): Promise<AppSettings>;
  saveSettings(partial: Partial<AppSettings>): Promise<AppSettings>;
  checkFfmpeg(overrides?: {
    ffmpegPath?: string;
    ffprobePath?: string;
  }): Promise<FfmpegBinaryConfig>;
  selectAudioFiles(): Promise<string[]>;
  selectAudioFolder(): Promise<string[]>;
  selectExportDirectory(): Promise<string>;
  selectFfmpegPath(): Promise<string>;
  selectFfprobePath(): Promise<string>;
  selectMetronomeSamplePath(): Promise<string>;
  createNewProject(): Promise<ProjectFile | null>;
  openProject(): Promise<ProjectFile | null>;
  openProjectByPath(filePath: string): Promise<ProjectFile | null>;
  saveProject(payload: { project: ProjectFile; filePath?: string }): Promise<ProjectFile | null>;
  saveProjectAs(payload: { project: ProjectFile }): Promise<ProjectFile | null>;
  saveRecovery(project: ProjectFile): Promise<boolean>;
  loadRecovery(): Promise<ProjectFile | null>;
  probeAudio(filePath: string): Promise<AudioProbeInfo>;
  detectTempo(filePath: string, analysisSeconds: number): Promise<TempoAnalysisResult>;
  preparePlaybackAudio(filePath: string): Promise<PreparedPlaybackAudio>;
  prepareSinglePreviewAudio(payload: {
    plan: SingleTrackExportPlan;
    mode: 'original' | 'processed' | 'metronome';
  }): Promise<PreparedPlaybackAudio>;
  prepareMedleyPreviewAudio(payload: {
    plan: MedleyExportPlan;
    mode: 'processed' | 'metronome';
  }): Promise<PreparedPlaybackAudio>;
  generateTrackProxies(payload: {
    plans: SingleTrackExportPlan[];
    bitrateKbps?: number;
  }): Promise<GeneratedTrackProxy[]>;
  getTrackProxyStatuses(payload: {
    plans: SingleTrackExportPlan[];
  }): Promise<TrackProxyStatusResult[]>;
  runSingleExport(payload: {
    id: string;
    plan: SingleTrackExportPlan;
    bitrateKbps?: number;
  }): Promise<string>;
  runMedleyExport(payload: {
    id: string;
    plan: MedleyExportPlan;
    bitrateKbps?: number;
  }): Promise<string>;
  onExportProgress(listener: (payload: ExportProgressPayload) => void): () => void;
  onMenuAction(listener: (payload: MenuActionPayload) => void): () => void;
  openPath(targetPath: string): Promise<boolean>;
  getPathForDroppedFile(file: File): string;
}
