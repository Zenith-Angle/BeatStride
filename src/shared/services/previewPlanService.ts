import type { ProjectFile, Track, TrackRenderPlan } from '../types';
import {
  buildMedleyExportPlan,
  buildSingleTrackExportPlan
} from './exportPlanService';

export function buildSingleTrackPreviewExportPlan(
  track: Track,
  project: Pick<ProjectFile, 'globalTargetBpm' | 'defaultMetronomeSamplePath' | 'mixTuning'>
) {
  return buildSingleTrackExportPlan(track, {
    globalTargetBpm: project.globalTargetBpm,
    outputDir: '',
    format: 'wav',
    metronomeSamplePath: project.defaultMetronomeSamplePath,
    normalizeLoudness: false,
    mixTuning: project.mixTuning
  });
}

export function buildSingleTrackPreviewPlan(
  track: Track,
  project: Pick<ProjectFile, 'globalTargetBpm' | 'defaultMetronomeSamplePath' | 'mixTuning'>
): TrackRenderPlan {
  return buildSingleTrackPreviewExportPlan(track, project).track;
}

export function buildProjectPreviewExportPlan(project: ProjectFile) {
  return buildMedleyExportPlan(project, {
    globalTargetBpm: project.globalTargetBpm,
    outputDir: '',
    format: 'wav',
    metronomeSamplePath: project.defaultMetronomeSamplePath,
    normalizeLoudness: false,
    gapMs: project.exportPreset.gapMs,
    crossfadeMs: project.exportPreset.crossfadeMs > 0 ? project.exportPreset.crossfadeMs : undefined,
    mixTuning: project.mixTuning
  });
}

export function buildProjectPreviewPlan(project: ProjectFile): TrackRenderPlan[] {
  return buildProjectPreviewExportPlan(project).clips.map((clip) => clip.track);
}
