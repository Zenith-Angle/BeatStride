import type {
  ExportBuildSettings,
  ExportSuffixRules,
  MedleyClipPlan,
  MedleyExportPlan,
  ProjectFile,
  SingleTrackExportPlan,
  Track,
  TrackRenderPlan
} from '../types';
import { alignMetronomeToDownbeat } from './alignmentService';
import { generateBeatTimes } from './beatGridService';
import { buildOutputFileName } from '../utils/fileName';

const DEFAULT_SUFFIX_RULES: ExportSuffixRules = {
  includeBpm: true,
  includeMetronomeTag: true,
  customSuffix: ''
};

function buildTrackRenderPlan(track: Track, globalTargetBpm: number): TrackRenderPlan {
  const trimmedSourceDurationMs = Math.max(
    0,
    track.durationMs - track.trimInMs - track.trimOutMs
  );
  const alignment = alignMetronomeToDownbeat(track, { globalTargetBpm });
  const processedDurationMs =
    alignment.speedRatio > 0 ? trimmedSourceDurationMs / alignment.speedRatio : 0;

  const beatTimesMs = track.metronomeEnabled
    ? generateBeatTimes(
        processedDurationMs,
        alignment.targetBpm,
        alignment.metronomeStartMs
      )
    : [];

  return {
    trackId: track.id,
    trackName: track.name,
    sourceFilePath: track.filePath,
    outputBaseName: buildOutputFileName(track, 'single', DEFAULT_SUFFIX_RULES),
    sourceBpm: alignment.sourceBpm,
    targetBpm: alignment.targetBpm,
    speedRatio: alignment.speedRatio,
    trimmedSourceDurationMs,
    processedDurationMs,
    downbeatOffsetMsAfterSpeed: alignment.downbeatOffsetMsAfterSpeed,
    metronomeStartMs: alignment.metronomeStartMs,
    beatTimesMs,
    trackStartMs: track.trackStartMs,
    trimInMs: track.trimInMs,
    trimOutMs: track.trimOutMs,
    fadeInMs: track.fadeInMs,
    fadeOutMs: track.fadeOutMs,
    volumeDb: track.volumeDb,
    pan: track.pan,
    metronomeEnabled: track.metronomeEnabled,
    metronomeVolumeDb: track.metronomeVolumeDb
  };
}

export function buildSingleTrackExportPlan(
  track: Track,
  settings: ExportBuildSettings
): SingleTrackExportPlan {
  return {
    mode: 'single',
    outputDir: settings.outputDir,
    format: settings.format,
    normalizeLoudness: settings.normalizeLoudness,
    metronomeSamplePath: settings.metronomeSamplePath,
    track: buildTrackRenderPlan(track, track.targetBpm ?? track.sourceBpm)
  };
}

export function buildMedleyExportPlan(
  project: ProjectFile,
  settings: ExportBuildSettings
): MedleyExportPlan {
  const clips: MedleyClipPlan[] = [];
  const enabledTracks = project.tracks.filter((t) => t.exportEnabled);
  let cursor = 0;
  let timelineMax = 0;

  for (const track of enabledTracks) {
    const renderPlan = buildTrackRenderPlan(track, project.globalTargetBpm);
    const timelineStartMs = Math.max(cursor, track.trackStartMs);
    const timelineEndMs = timelineStartMs + renderPlan.processedDurationMs;
    clips.push({
      track: renderPlan,
      timelineStartMs,
      timelineEndMs
    });
    cursor = timelineEndMs + (settings.gapMs ?? 0);
    timelineMax = Math.max(timelineMax, timelineEndMs);
  }

  return {
    mode: 'medley',
    outputDir: settings.outputDir,
    format: settings.format,
    normalizeLoudness: settings.normalizeLoudness,
    gapMs: settings.gapMs ?? 0,
    crossfadeMs: settings.crossfadeMs ?? 0,
    metronomeSamplePath: settings.metronomeSamplePath,
    clips,
    durationMs: timelineMax
  };
}
