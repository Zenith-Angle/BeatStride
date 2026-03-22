import type { AlignmentSettings, Track } from '../types';
import { computeSpeedRatio } from '../utils/tempo';

export interface AlignedMetronomeResult {
  targetBpm: number;
  sourceBpm: number;
  speedRatio: number;
  downbeatOffsetMsAfterSpeed: number;
  metronomeStartMs: number;
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
  const targetBpm = track.targetBpm ?? globalSettings.globalTargetBpm;
  const speedRatio = computeSpeedRatio(sourceBpm, targetBpm);
  const downbeatOffsetMsAfterSpeed = track.downbeatOffsetMs / speedRatio;
  const metronomeStartMs = downbeatOffsetMsAfterSpeed + track.metronomeOffsetMs;

  return {
    targetBpm,
    sourceBpm,
    speedRatio,
    downbeatOffsetMsAfterSpeed,
    metronomeStartMs
  };
}
