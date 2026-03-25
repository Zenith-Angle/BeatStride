import type {
  AppSettings,
  AudioProbeInfo,
  FfmpegBinaryConfig,
  MedleyExportPlan,
  ProjectFile,
  SingleTrackExportPlan
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
