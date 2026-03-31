import type {
  MedleyExportPlan,
  ResolvedStretchEngine,
  SingleTrackExportPlan
} from '../types';
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

function buildRubberbandFilter(ratio: number): string {
  return `rubberband=tempo=${ratio.toFixed(8)}:transients=crisp:formant=preserved:phase=laminar:window=short`;
}

function buildTempoFilter(ratio: number, engine: ResolvedStretchEngine): string {
  return engine === 'rubberband' ? buildRubberbandFilter(ratio) : buildAtempoFilter(ratio);
}

function buildLoudnormFilter(plan: Pick<SingleTrackExportPlan | MedleyExportPlan, 'renderOptions'>): string {
  return `loudnorm=I=${plan.renderOptions.targetLufs}:TP=${plan.renderOptions.targetTp}:LRA=${plan.renderOptions.targetLra}`;
}

function appendFinalProcessing(
  filters: string[],
  inputLabel: string,
  plan: Pick<SingleTrackExportPlan | MedleyExportPlan, 'normalizeLoudness' | 'renderOptions'>
): string {
  let currentLabel = inputLabel;

  if (plan.normalizeLoudness) {
    const nextLabel = '[norm]';
    filters.push(`${currentLabel}${buildLoudnormFilter(plan)}${nextLabel}`);
    currentLabel = nextLabel;
  }

  if (plan.renderOptions.headroomDb > 0) {
    const nextLabel = '[final]';
    filters.push(
      `${currentLabel}volume=${dbToLinear(-Math.abs(plan.renderOptions.headroomDb))}${nextLabel}`
    );
    currentLabel = nextLabel;
  }

  return currentLabel;
}

export function buildSingleTrackFilterGraph(
  plan: SingleTrackExportPlan,
  metronomeInputIndex?: number
): { graph: string; outputLabel: string } {
  const track = plan.track;
  const filters: string[] = [];
  const trimStart = msToSec(track.trimInMs);
  const trimEnd = msToSec(track.trimmedSourceDurationMs + track.trimInMs);
  const tempoFilter = buildTempoFilter(
    track.speedRatio,
    plan.renderOptions.resolvedStretchEngine ?? 'atempo'
  );
  const fadeInSec = msToSec(track.fadeInMs);
  const fadeOutSec = msToSec(track.fadeOutMs);
  const fadeOutStart = Math.max(0, msToSec(track.processedDurationMs) - fadeOutSec);
  const { left, right } = panToChannelScale(track.pan);
  const mainChain = [
    `atrim=start=${trimStart}:end=${trimEnd}`,
    'asetpts=PTS-STARTPTS',
    tempoFilter,
    `afade=t=in:st=0:d=${fadeInSec}`,
    `afade=t=out:st=${fadeOutStart}:d=${fadeOutSec}`,
    `volume=${dbToLinear(track.volumeDb)}`
  ];

  if (left !== 1 || right !== 1) {
    mainChain.push(`pan=stereo|c0=${left}*FL|c1=${right}*FR`);
  }

  filters.push(
    `[0:a]${mainChain.join(',')}[main]`
  );

  let currentLabel = '[main]';
  if (metronomeInputIndex !== undefined && track.metronomeEnabled) {
    filters.push(
      `[${metronomeInputIndex}:a]volume=${dbToLinear(track.metronomeVolumeDb + plan.renderOptions.beatGainDb)}[metro]`
    );
    filters.push(`${currentLabel}[metro]amix=inputs=2:normalize=0[mix]`);
    currentLabel = '[mix]';
  }

  const outputLabel = appendFinalProcessing(filters, currentLabel, plan);
  return { graph: filters.join(';'), outputLabel };
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
    const filters: string[] = [`${inputLabels[0]}anull[mix]`];
    const final = appendFinalProcessing(filters, '[mix]', plan);
    return {
      graph: filters.join(';'),
      outputLabel: final
    };
  }

  if (plan.crossfadeMs > 0) {
    const fadeSec = msToSec(plan.crossfadeMs);
    const duckLinear =
      plan.transitionDuckDb > 0 ? dbToLinear(-Math.abs(plan.transitionDuckDb)) : 1;
    const filters: string[] = [];
    const preparedLabels = inputLabels.map((label, idx) => {
      const next = `[src${idx}]`;
      if (duckLinear !== 1) {
        filters.push(`${label}volume=${duckLinear}${next}`);
      } else {
        filters.push(`${label}anull${next}`);
      }
      return next;
    });

    let current = '';
    preparedLabels.forEach((label, idx) => {
      if (idx === 0) {
        current = '[xf0]';
        filters.push(`${label}anull${current}`);
      } else {
        const next = idx === inputLabels.length - 1 ? '[mix]' : `[xf${idx}]`;
        filters.push(`${current}${label}acrossfade=d=${fadeSec}:c1=tri:c2=tri${next}`);
        current = next;
      }
    });
    const outputLabel = appendFinalProcessing(filters, '[mix]', plan);
    return { graph: filters.join(';'), outputLabel };
  }

  const concatInputs = inputLabels.join('');
  const filters = [`${concatInputs}concat=n=${inputLabels.length}:v=0:a=1[mix]`];
  const outputLabel = appendFinalProcessing(filters, '[mix]', plan);
  return {
    graph: filters.join(';'),
    outputLabel
  };
}
