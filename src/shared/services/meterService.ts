import {
  DEFAULT_ACCENT_PATTERN,
  DEFAULT_BEATS_PER_BAR,
  DEFAULT_TIME_SIGNATURE
} from '../constants';
import type { TimeSignature } from '../types';

const METER_PRESETS: Record<TimeSignature, { beatsPerBar: number; accentPattern: number[] }> = {
  '3/4': {
    beatsPerBar: 3,
    accentPattern: [1.35, 1, 1]
  },
  '4/4': {
    beatsPerBar: 4,
    accentPattern: [...DEFAULT_ACCENT_PATTERN]
  },
  '6/8': {
    beatsPerBar: 6,
    accentPattern: [1.35, 1, 1, 1.15, 1, 1]
  }
};

export function resolveTimeSignature(
  signature?: string,
  beatsPerBar = DEFAULT_BEATS_PER_BAR
): TimeSignature {
  if (signature === '3/4' || signature === '4/4' || signature === '6/8') {
    return signature;
  }
  if (beatsPerBar === 3) {
    return '3/4';
  }
  if (beatsPerBar === 6) {
    return '6/8';
  }
  return DEFAULT_TIME_SIGNATURE;
}

export function getDefaultMeterMetadata(signature?: string, beatsPerBar?: number): {
  timeSignature: TimeSignature;
  beatsPerBar: number;
  accentPattern: number[];
} {
  const timeSignature = resolveTimeSignature(signature, beatsPerBar);
  const preset = METER_PRESETS[timeSignature];
  return {
    timeSignature,
    beatsPerBar: preset.beatsPerBar,
    accentPattern: [...preset.accentPattern]
  };
}

export function normalizeAccentPattern(
  accentPattern: number[] | undefined,
  beatsPerBar = DEFAULT_BEATS_PER_BAR,
  signature?: string
): number[] {
  const fallback = getDefaultMeterMetadata(signature, beatsPerBar).accentPattern;
  if (!Array.isArray(accentPattern) || accentPattern.length === 0) {
    return fallback;
  }

  const normalized = accentPattern
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (normalized.length !== beatsPerBar) {
    return fallback;
  }

  return normalized;
}

export function buildBeatAccentValues(
  beatCount: number,
  accentPattern: number[] | undefined
): number[] {
  const pattern = normalizeAccentPattern(accentPattern);
  return Array.from({ length: beatCount }, (_, index) => pattern[index % pattern.length] ?? 1);
}
