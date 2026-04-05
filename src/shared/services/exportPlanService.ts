import type {
  ExportBuildSettings,
  ExportSuffixRules,
  MedleyClipPlan,
  MedleyExportPlan,
  MixTuningSettings,
  ProjectFile,
  SingleTrackExportPlan,
  Track,
  TrackRenderPlan
} from '../types';
import { resolveTrackAlignment } from './alignmentService';
import { generateBeatTimes } from './beatGridService';
import { buildOutputFileName } from '../utils/fileName';
import { normalizeAccentPattern } from './meterService';
import { getWorkspaceTracks } from './workspaceOrderService';

const DEFAULT_SUFFIX_RULES: ExportSuffixRules = {
  includeBpm: true,
  includeMetronomeTag: true,
  customSuffix: ''
};

function computeTransitionMs(targetBpm: number, beatsPerBar: number, transitionBars: number): number {
  const safeBpm = Math.max(1, targetBpm);
  const safeBeatsPerBar = Math.max(1, beatsPerBar);
  const barMs = (60000 / safeBpm) * safeBeatsPerBar;
  return Math.max(0, Math.round(transitionBars * barMs));
}

function buildTrackRenderPlan(
  track: Track,
  globalTargetBpm: number,
  mixTuning: MixTuningSettings
): TrackRenderPlan {
  const trimmedSourceDurationMs = Math.max(
    0,
    track.durationMs - track.trimInMs - track.trimOutMs
  );
  const alignment = resolveTrackAlignment(track, {
    globalTargetBpm,
    harmonicTolerance: mixTuning.harmonicTolerance,
    harmonicMappingEnabled: mixTuning.harmonicMappingEnabled,
    halfMapUpperBpm: mixTuning.halfMapUpperBpm
  });
  const processedDurationMs =
    alignment.speedRatio > 0 ? trimmedSourceDurationMs / alignment.speedRatio : 0;

  const beatTimesMs = track.metronomeEnabled
    ? generateBeatTimes(
        processedDurationMs,
        globalTargetBpm,
        alignment.metronomeStartMs
      )
    : [];

  return {
    trackId: track.id,
    trackName: track.name,
    sourceFilePath: track.filePath,
    outputBaseName: buildOutputFileName(
      { ...track, targetBpm: alignment.targetBpm },
      'single',
      DEFAULT_SUFFIX_RULES
    ),
    sourceBpm: alignment.sourceBpm,
    effectiveSourceBpm: alignment.effectiveSourceBpm,
    targetBpm: alignment.targetBpm,
    metronomeBpm: globalTargetBpm,
    speedRatio: alignment.speedRatio,
    trimmedSourceDurationMs,
    processedDurationMs,
    downbeatOffsetMsAfterSpeed: alignment.downbeatOffsetMsAfterSpeed,
    metronomeStartMs: alignment.metronomeStartMs,
    beatTimesMs,
    beatsPerBar: Math.max(1, track.beatsPerBar),
    accentPattern: normalizeAccentPattern(track.accentPattern, track.beatsPerBar, track.timeSignature),
    harmonicMode: alignment.harmonicMode,
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
  const globalTargetBpm = settings.globalTargetBpm;
  return {
    mode: 'single',
    projectFilePath: settings.projectFilePath,
    outputDir: settings.outputDir,
    format: settings.format,
    normalizeLoudness: settings.normalizeLoudness,
    metronomeSamplePath: settings.metronomeSamplePath,
    renderOptions: {
      beatGainDb: settings.mixTuning.beatGainDb,
      beatOriginalBpm: settings.mixTuning.beatOriginalBpm,
      beatRenderMode: settings.mixTuning.beatRenderMode,
      stretchEngine: settings.mixTuning.stretchEngine,
      headroomDb: settings.mixTuning.headroomDb,
      targetLufs: settings.mixTuning.targetLufs,
      targetLra: settings.mixTuning.targetLra,
      targetTp: settings.mixTuning.targetTp
    },
    track: buildTrackRenderPlan(track, globalTargetBpm, settings.mixTuning)
  };
}

export function buildMedleyExportPlan(
  project: ProjectFile,
  settings: ExportBuildSettings
): MedleyExportPlan {
  const clips: MedleyClipPlan[] = [];
  const enabledTracks = getWorkspaceTracks(project.tracks);
  const mixTuning = settings.mixTuning;
  const fixedCrossfadeMs = settings.crossfadeMs;
  const gapMs = settings.gapMs ?? 0;
  let cursor = 0;
  let timelineMax = 0;
  let nextTransitionInMs = 0;

  for (const track of enabledTracks) {
    const renderPlan = buildTrackRenderPlan(track, project.globalTargetBpm, mixTuning);
    const timelineStartMs = Math.max(cursor, track.trackStartMs);
    const timelineEndMs = timelineStartMs + renderPlan.processedDurationMs;
    const transitionOutMs =
      fixedCrossfadeMs ??
      computeTransitionMs(renderPlan.targetBpm, renderPlan.beatsPerBar, mixTuning.transitionBars);
    clips.push({
      track: renderPlan,
      timelineStartMs,
      timelineEndMs,
      transitionInMs: nextTransitionInMs
    });
    cursor = Math.max(0, timelineEndMs - transitionOutMs) + gapMs;
    timelineMax = Math.max(timelineMax, timelineEndMs);
    nextTransitionInMs = transitionOutMs;
  }

  return {
    mode: 'medley',
    projectFilePath: project.meta.filePath,
    outputDir: settings.outputDir,
    format: settings.format,
    normalizeLoudness: settings.normalizeLoudness,
    gapMs,
    crossfadeMs: fixedCrossfadeMs ?? Math.max(0, ...clips.map((clip) => clip.transitionInMs)),
    transitionDuckDb: settings.transitionDuckDb ?? mixTuning.transitionDuckDb,
    metronomeSamplePath: settings.metronomeSamplePath,
    renderOptions: {
      beatGainDb: mixTuning.beatGainDb,
      beatOriginalBpm: mixTuning.beatOriginalBpm,
      beatRenderMode: mixTuning.beatRenderMode,
      stretchEngine: mixTuning.stretchEngine,
      headroomDb: mixTuning.headroomDb,
      targetLufs: mixTuning.targetLufs,
      targetLra: mixTuning.targetLra,
      targetTp: mixTuning.targetTp
    },
    clips,
    durationMs: clips.length === 0 ? 0 : Math.max(0, timelineMax)
  };
}
