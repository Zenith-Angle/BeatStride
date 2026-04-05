import type { AlignmentSettings, Track } from '../types';
import { computeSpeedRatio } from '../utils/tempo';

export interface AlignedMetronomeResult {
  targetBpm: number;
  sourceBpm: number;
  effectiveSourceBpm: number;
  speedRatio: number;
  downbeatOffsetMsAfterSpeed: number;
  metronomeStartMs: number;
  harmonicMode: string;
}

const INTERMEDIATE_TARGET_BPM = 120;

export function resolveAlignedTargetBpm(
  sourceBpm: number,
  explicitTargetBpm: number | undefined,
  globalTargetBpm: number
): { targetBpm: number; mode: string } {
  if (explicitTargetBpm && explicitTargetBpm > 0) {
    return { targetBpm: explicitTargetBpm, mode: 'manual-target' };
  }

  if (globalTargetBpm >= 160 && sourceBpm >= 100 && sourceBpm <= 125) {
    return { targetBpm: INTERMEDIATE_TARGET_BPM, mode: 'comfort-target->120' };
  }

  return { targetBpm: globalTargetBpm, mode: 'global-target' };
}

export function resolveHarmonicMultiplier(
  sourceBpm: number,
  targetBpm: number,
  tolerance = 0.12,
  disableMapping = false,
  halfMapUpperBpm = 110
): { multiplier: number; mode: string } {
  if (disableMapping || sourceBpm <= 0 || targetBpm <= 0) {
    return { multiplier: 1, mode: 'direct' };
  }

  if (halfMapUpperBpm > 0 && sourceBpm < 100 && sourceBpm <= halfMapUpperBpm) {
    return { multiplier: 2, mode: 'half-time->target(range-rule)' };
  }

  const halfTarget = targetBpm / 2;
  const doubleTarget = targetBpm * 2;

  if (sourceBpm < 100 && halfTarget > 0) {
    const halfDiff = Math.abs(sourceBpm - halfTarget) / halfTarget;
    if (halfDiff <= tolerance) {
      return { multiplier: 2, mode: 'half-time->target' };
    }
  }

  const doubleDiff = Math.abs(sourceBpm - doubleTarget) / doubleTarget;
  if (doubleDiff <= tolerance) {
    return { multiplier: 0.5, mode: 'double-time->target' };
  }

  const directRate = targetBpm / sourceBpm;
  const mappedRateX2 = targetBpm / (sourceBpm * 2);
  const mappedRateX05 = targetBpm / (sourceBpm * 0.5);

  if (sourceBpm < 100 && directRate >= 1.8 && mappedRateX2 >= 0.78 && mappedRateX2 <= 1.35) {
    return { multiplier: 2, mode: 'half-time->target(heuristic)' };
  }
  if (directRate <= 0.6 && mappedRateX05 >= 0.78 && mappedRateX05 <= 1.35) {
    return { multiplier: 0.5, mode: 'double-time->target(heuristic)' };
  }

  return { multiplier: 1, mode: 'direct' };
}

export function alignMetronomeToDownbeat(
  track: Pick<
    Track,
    | 'sourceBpm'
    | 'targetBpm'
    | 'detectedBpm'
    | 'downbeatOffsetMs'
    | 'metronomeOffsetMs'
  >,
  globalSettings: AlignmentSettings
): AlignedMetronomeResult {
  const sourceBpm = track.sourceBpm || track.detectedBpm || globalSettings.globalTargetBpm;
  const target = resolveAlignedTargetBpm(
    sourceBpm,
    track.targetBpm,
    globalSettings.globalTargetBpm
  );
  const targetBpm = target.targetBpm;
  const harmonic = resolveHarmonicMultiplier(
    sourceBpm,
    targetBpm,
    globalSettings.harmonicTolerance,
    globalSettings.harmonicMappingEnabled === false,
    globalSettings.halfMapUpperBpm
  );
  const effectiveSourceBpm = sourceBpm * harmonic.multiplier;
  const speedRatio = computeSpeedRatio(effectiveSourceBpm, targetBpm);
  const downbeatOffsetMsAfterSpeed = track.downbeatOffsetMs / speedRatio;
  const metronomeStartMs = downbeatOffsetMsAfterSpeed + track.metronomeOffsetMs;

  return {
    targetBpm,
    sourceBpm,
    effectiveSourceBpm,
    speedRatio,
    downbeatOffsetMsAfterSpeed,
    metronomeStartMs,
    harmonicMode:
      target.mode === 'global-target' ? harmonic.mode : `${target.mode} / ${harmonic.mode}`
  };
}

export function resolveTrackAlignment(
  track: Pick<
    Track,
    | 'sourceBpm'
    | 'targetBpm'
    | 'detectedBpm'
    | 'downbeatOffsetMs'
    | 'metronomeOffsetMs'
    | 'alignmentSuggestion'
  >,
  globalSettings: AlignmentSettings
): AlignedMetronomeResult {
  if (track.alignmentSuggestion) {
    const sourceBpm = track.sourceBpm || track.detectedBpm || globalSettings.globalTargetBpm;
    const recommendedTargetBpm = track.alignmentSuggestion.recommendedTargetBpm;
    const speedRatio =
      track.alignmentSuggestion.speedRatio > 0
        ? track.alignmentSuggestion.speedRatio
        : computeSpeedRatio(sourceBpm, recommendedTargetBpm);

    return {
      targetBpm: recommendedTargetBpm,
      sourceBpm,
      effectiveSourceBpm: track.alignmentSuggestion.effectiveSourceBpm,
      speedRatio,
      downbeatOffsetMsAfterSpeed: track.alignmentSuggestion.downbeatOffsetMsAfterSpeed,
      metronomeStartMs:
        track.alignmentSuggestion.recommendedMetronomeStartMs + track.metronomeOffsetMs,
      harmonicMode: track.alignmentSuggestion.harmonicMode
    };
  }

  return alignMetronomeToDownbeat(track, globalSettings);
}
