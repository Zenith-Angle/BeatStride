import type { MedleyExportPlan, SingleTrackExportPlan } from '../types';
import { splitAtempoChain } from '../utils/tempo';
import { msToSec } from '../utils/time';

function dbToLinear(db: number): number {
  return Number((10 ** (db / 20)).toFixed(6));
}

function panToChannelScale(pan: number): { left: number; right: number } {
  if (pan === 0) {
    return { left: 1, right: 1 };
  }
  if (pan < 0) {
    return { left: 1, right: Math.max(0, 1 + pan) };
  }
  return { left: Math.max(0, 1 - pan), right: 1 };
}

export function buildAtempoFilter(ratio: number): string {
  const chain = splitAtempoChain(ratio);
  return chain.map((item) => `atempo=${item}`).join(',');
}

export function buildSingleTrackFilterGraph(
  plan: SingleTrackExportPlan,
  metronomeInputIndex?: number
): { graph: string; outputLabel: string } {
  const track = plan.track;
  const filters: string[] = [];
  const trimStart = msToSec(track.trimInMs);
  const trimEnd = msToSec(track.trimmedSourceDurationMs + track.trimInMs);
  const atempo = buildAtempoFilter(track.speedRatio);
  const fadeInSec = msToSec(track.fadeInMs);
  const fadeOutSec = msToSec(track.fadeOutMs);
  const fadeOutStart = Math.max(0, msToSec(track.processedDurationMs) - fadeOutSec);
  const { left, right } = panToChannelScale(track.pan);

  filters.push(
    `[0:a]atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS,${atempo},afade=t=in:st=0:d=${fadeInSec},afade=t=out:st=${fadeOutStart}:d=${fadeOutSec},volume=${dbToLinear(track.volumeDb)},pan=stereo|c0=c0*${left}|c1=c1*${right}[main]`
  );

  if (metronomeInputIndex !== undefined && track.metronomeEnabled) {
    filters.push(
      `[${metronomeInputIndex}:a]volume=${dbToLinear(track.metronomeVolumeDb)}[metro]`
    );
    filters.push(`[main][metro]amix=inputs=2:normalize=0[mix]`);
    const out = plan.normalizeLoudness ? '[mixnorm]' : '[mix]';
    if (plan.normalizeLoudness) {
      filters.push(`[mix]loudnorm=I=-16:TP=-1.5:LRA=11[mixnorm]`);
    }
    return { graph: filters.join(';'), outputLabel: out };
  }

  if (plan.normalizeLoudness) {
    filters.push('[main]loudnorm=I=-16:TP=-1.5:LRA=11[mainnorm]');
    return { graph: filters.join(';'), outputLabel: '[mainnorm]' };
  }

  return { graph: filters.join(';'), outputLabel: '[main]' };
}

export function buildOutputCodecArgs(format: 'wav' | 'mp3', bitrateKbps = 320): string[] {
  if (format === 'wav') {
    return ['-c:a', 'pcm_s16le'];
  }
  return ['-c:a', 'libmp3lame', '-b:a', `${bitrateKbps}k`];
}

export function buildMedleyMixFilter(
  plan: MedleyExportPlan,
  inputLabels: string[]
): { graph: string; outputLabel: string } {
  if (inputLabels.length === 0) {
    return { graph: '', outputLabel: '' };
  }
  if (inputLabels.length === 1) {
    const final = plan.normalizeLoudness ? '[mixnorm]' : '[mix]';
    const normalize = plan.normalizeLoudness
      ? ';[mix]loudnorm=I=-16:TP=-1.5:LRA=11[mixnorm]'
      : '';
    return {
      graph: `${inputLabels[0]}anull[mix]${normalize}`,
      outputLabel: final
    };
  }

  if (plan.crossfadeMs > 0) {
    const fadeSec = msToSec(plan.crossfadeMs);
    let chain = '';
    let current = '';
    inputLabels.forEach((label, idx) => {
      if (idx === 0) {
        current = '[xf0]';
        chain += `${label}anull${current};`;
      } else {
        const next = idx === inputLabels.length - 1 ? '[mix]' : `[xf${idx}]`;
        chain += `${current}${label}acrossfade=d=${fadeSec}:c1=tri:c2=tri${next};`;
        current = next;
      }
    });
    if (plan.normalizeLoudness) {
      chain += '[mix]loudnorm=I=-16:TP=-1.5:LRA=11[mixnorm]';
      return { graph: chain, outputLabel: '[mixnorm]' };
    }
    return { graph: chain.replace(/;$/, ''), outputLabel: '[mix]' };
  }

  const concatInputs = inputLabels.join('');
  const graph = `${concatInputs}concat=n=${inputLabels.length}:v=0:a=1[mix]${
    plan.normalizeLoudness ? ';[mix]loudnorm=I=-16:TP=-1.5:LRA=11[mixnorm]' : ''
  }`;
  return {
    graph,
    outputLabel: plan.normalizeLoudness ? '[mixnorm]' : '[mix]'
  };
}
