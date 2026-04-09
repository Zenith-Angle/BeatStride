import type {
  MetronomeRenderRequest,
  ProjectRenderOptions,
  SingleTrackExportPlan,
  TrackRenderPlan
} from '../types';

export const DEFAULT_METRONOME_RENDER_SAMPLE_RATE = 48000;
export const DEFAULT_METRONOME_RENDER_CHANNELS = 2;

interface MetronomeRenderSource {
  metronomeSamplePath: string;
  renderOptions: Pick<
    ProjectRenderOptions,
    'beatGainDb' | 'beatOriginalBpm' | 'beatRenderMode'
  >;
  track: Pick<
    TrackRenderPlan,
    'processedDurationMs' | 'beatTimesMs' | 'accentPattern' | 'metronomeBpm'
  >;
}

function normalizeRoundedBeatTimes(beatTimesMs: number[]): number[] {
  return beatTimesMs.map((value) => Math.max(0, Math.round(value)));
}

function normalizeAccentPattern(accentPattern: number[]): number[] {
  if (accentPattern.length === 0) {
    return [1.35, 1, 1, 1];
  }
  return accentPattern.map((value) => Math.max(0.05, Number(value.toFixed(4))));
}

export function buildMetronomeRenderRequest(
  source: MetronomeRenderSource,
  outputPath: string,
  overrides?: {
    sampleRate?: number;
    channels?: number;
  }
): MetronomeRenderRequest {
  return {
    samplePath: source.metronomeSamplePath,
    outputPath,
    durationMs: Math.max(0, Math.round(source.track.processedDurationMs)),
    beatTimesMs: normalizeRoundedBeatTimes(source.track.beatTimesMs),
    accentPattern: normalizeAccentPattern(source.track.accentPattern),
    beatGainDb: Number(source.renderOptions.beatGainDb.toFixed(4)),
    beatRenderMode: source.renderOptions.beatRenderMode,
    beatOriginalBpm: Number(source.renderOptions.beatOriginalBpm.toFixed(4)),
    metronomeBpm: Number(source.track.metronomeBpm.toFixed(4)),
    sampleRate: overrides?.sampleRate ?? DEFAULT_METRONOME_RENDER_SAMPLE_RATE,
    channels: overrides?.channels ?? DEFAULT_METRONOME_RENDER_CHANNELS
  };
}

export function buildMetronomeRenderCacheKeyInput(
  source: MetronomeRenderSource,
  overrides?: {
    sampleRate?: number;
    channels?: number;
  }
): Omit<MetronomeRenderRequest, 'outputPath'> {
  const { outputPath: _, ...rest } = buildMetronomeRenderRequest(source, '__cache__', overrides);
  return rest;
}

export function buildSingleTrackMetronomeRenderCacheKeyInput(
  plan: Pick<SingleTrackExportPlan, 'metronomeSamplePath' | 'renderOptions' | 'track'>
): Omit<MetronomeRenderRequest, 'outputPath'> {
  return buildMetronomeRenderCacheKeyInput(plan);
}
