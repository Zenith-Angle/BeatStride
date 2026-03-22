import { create } from 'zustand';
import type { ExportJob, ProjectFile, Track } from '@shared/types';
import {
  buildMedleyExportPlan,
  buildSingleTrackExportPlan
} from '@shared/services/exportPlanService';

interface ExportState {
  jobs: ExportJob[];
  progressMap: Record<string, number>;
  setupProgressListener: () => void;
  exportSingleTrack: (
    track: Track,
    project: ProjectFile,
    options: { outputDir: string; format: 'wav' | 'mp3'; bitrateKbps: number }
  ) => Promise<void>;
  exportMedley: (
    project: ProjectFile,
    options: { outputDir: string; format: 'wav' | 'mp3'; bitrateKbps: number }
  ) => Promise<void>;
}

let listenerBound = false;

function markJob(
  jobs: ExportJob[],
  id: string,
  patch: Partial<ExportJob>
): ExportJob[] {
  return jobs.map((job) => (job.id === id ? { ...job, ...patch } : job));
}

export const useExportStore = create<ExportState>((set) => ({
  jobs: [],
  progressMap: {},
  setupProgressListener: () => {
    if (listenerBound) {
      return;
    }
    listenerBound = true;
    window.beatStride.onExportProgress((payload) => {
      set((state) => ({
        progressMap: { ...state.progressMap, [payload.id]: payload.progress },
        jobs: markJob(state.jobs, payload.id, {
          progress: payload.progress,
          status: 'running'
        })
      }));
    });
  },
  exportSingleTrack: async (track, project, options) => {
    const id = crypto.randomUUID();
    const job: ExportJob = {
      id,
      mode: 'single',
      status: 'queued',
      progress: 0,
      startedAt: new Date().toISOString()
    };
    set((state) => ({ jobs: [job, ...state.jobs] }));
    try {
      const plan = buildSingleTrackExportPlan(track, {
        outputDir: options.outputDir,
        format: options.format,
        metronomeSamplePath:
          project.defaultMetronomeSamplePath || project.exportPreset.outputDir,
        normalizeLoudness: project.exportPreset.normalizeLoudness
      });
      const outputPath = await window.beatStride.runSingleExport({
        id,
        plan,
        bitrateKbps: options.bitrateKbps
      });
      set((state) => ({
        jobs: markJob(state.jobs, id, {
          status: 'completed',
          progress: 1,
          endedAt: new Date().toISOString(),
          outputPath
        })
      }));
    } catch (error) {
      set((state) => ({
        jobs: markJob(state.jobs, id, {
          status: 'failed',
          endedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error)
        })
      }));
    }
  },
  exportMedley: async (project, options) => {
    const id = crypto.randomUUID();
    const job: ExportJob = {
      id,
      mode: 'medley',
      status: 'queued',
      progress: 0,
      startedAt: new Date().toISOString()
    };
    set((state) => ({ jobs: [job, ...state.jobs] }));
    try {
      const plan = buildMedleyExportPlan(project, {
        outputDir: options.outputDir,
        format: options.format,
        metronomeSamplePath:
          project.defaultMetronomeSamplePath || project.exportPreset.outputDir,
        normalizeLoudness: project.exportPreset.normalizeLoudness,
        gapMs: project.exportPreset.gapMs,
        crossfadeMs: project.exportPreset.crossfadeMs
      });
      const outputPath = await window.beatStride.runMedleyExport({
        id,
        plan,
        bitrateKbps: options.bitrateKbps
      });
      set((state) => ({
        jobs: markJob(state.jobs, id, {
          status: 'completed',
          progress: 1,
          endedAt: new Date().toISOString(),
          outputPath
        })
      }));
    } catch (error) {
      set((state) => ({
        jobs: markJob(state.jobs, id, {
          status: 'failed',
          endedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error)
        })
      }));
    }
  }
}));
