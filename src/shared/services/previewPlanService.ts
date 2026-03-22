import type { ProjectFile, Track, TrackRenderPlan } from '../types';
import {
  buildMedleyExportPlan,
  buildSingleTrackExportPlan
} from './exportPlanService';

export function buildSingleTrackPreviewPlan(
  track: Track,
  project: Pick<ProjectFile, 'globalTargetBpm' | 'defaultMetronomeSamplePath'>
): TrackRenderPlan {
  return buildSingleTrackExportPlan(track, {
    outputDir: '',
    format: 'wav',
    metronomeSamplePath: project.defaultMetronomeSamplePath,
    normalizeLoudness: false
  }).track;
}

export function buildProjectPreviewPlan(project: ProjectFile): TrackRenderPlan[] {
  return buildMedleyExportPlan(project, {
    outputDir: '',
    format: 'wav',
    metronomeSamplePath: project.defaultMetronomeSamplePath,
    normalizeLoudness: false,
    gapMs: project.exportPreset.gapMs,
    crossfadeMs: project.exportPreset.crossfadeMs
  }).clips.map((clip) => clip.track);
}
