import type { ExportMode, ExportSuffixRules, Track } from '../types';

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim();
}

function stripExtension(fileName: string): string {
  const normalized = fileName.split(/[\\/]/).pop() ?? fileName;
  const index = normalized.lastIndexOf('.');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

export function buildOutputFileName(
  track: Pick<Track, 'name' | 'targetBpm' | 'sourceBpm' | 'metronomeEnabled'>,
  mode: ExportMode,
  suffixRules: ExportSuffixRules
): string {
  const base = sanitizeFileName(stripExtension(track.name) || 'track');
  const parts: string[] = [base];
  const bpm = track.targetBpm ?? track.sourceBpm;

  if (suffixRules.includeBpm) {
    parts.push(`bpm${Math.round(bpm)}`);
  }
  if (suffixRules.includeMetronomeTag && track.metronomeEnabled) {
    parts.push('metronome');
  }
  if (mode === 'medley') {
    parts.push('medley');
  } else {
    parts.push('mix');
  }
  if (suffixRules.customSuffix.trim()) {
    parts.push(sanitizeFileName(suffixRules.customSuffix.trim()));
  }
  return parts.join('__');
}

export function buildMedleyOutputBaseName(
  projectName?: string,
  customBaseName?: string
): string {
  const baseCandidate = (customBaseName?.trim() || projectName?.trim() || 'beatstride_medley').trim();
  return sanitizeFileName(stripExtension(baseCandidate) || 'beatstride_medley');
}
