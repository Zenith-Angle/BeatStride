import { describe, expect, test } from 'vitest';
import {
  buildMedleyExportPlan,
  buildSingleTrackExportPlan
} from '../src/shared/services/exportPlanService';
import { DEFAULT_MIX_TUNING } from '../src/shared/constants';
import { buildOutputFileName } from '../src/shared/utils/fileName';
import type { ProjectFile, Track } from '../src/shared/types';

const track: Track = {
  id: 't1',
  name: 'run-song.mp3',
  filePath: 'C:/music/run-song.mp3',
  durationMs: 120000,
  sampleRate: 44100,
  channels: 2,
  detectedBpm: 176,
  sourceBpm: 176,
  targetBpm: 180,
  speedRatio: 1.02272727,
  downbeatOffsetMs: 120,
  metronomeOffsetMs: 10,
  trackStartMs: 0,
  trimInMs: 1000,
  trimOutMs: 2000,
  fadeInMs: 200,
  fadeOutMs: 300,
  volumeDb: 0,
  pan: 0,
  metronomeEnabled: true,
  metronomeVolumeDb: -8,
  exportEnabled: true,
  inTimeline: true
};

describe('buildSingleTrackExportPlan', () => {
  test('creates render plan with beat points', () => {
    const plan = buildSingleTrackExportPlan(track, {
      globalTargetBpm: 180,
      outputDir: 'C:/exports',
      format: 'wav',
      metronomeSamplePath: 'C:/click.wav',
      normalizeLoudness: false,
      mixTuning: DEFAULT_MIX_TUNING
    });
    expect(plan.track.processedDurationMs).toBeGreaterThan(0);
    expect(plan.track.beatTimesMs.length).toBeGreaterThan(0);
  });

  test('falls back to project target bpm when track target bpm is empty', () => {
    const plan = buildSingleTrackExportPlan(
      {
        ...track,
        targetBpm: undefined
      },
      {
        globalTargetBpm: 180,
        outputDir: 'C:/exports',
        format: 'wav',
        metronomeSamplePath: 'C:/click.wav',
        normalizeLoudness: false,
        mixTuning: DEFAULT_MIX_TUNING
      }
    );

    expect(plan.track.targetBpm).toBe(180);
  });

  test('keeps metronome bpm at global target when comfort target drops music to 120', () => {
    const plan = buildSingleTrackExportPlan(
      {
        ...track,
        sourceBpm: 110,
        detectedBpm: 110,
        targetBpm: undefined
      },
      {
        globalTargetBpm: 180,
        outputDir: 'C:/exports',
        format: 'wav',
        metronomeSamplePath: 'C:/click.wav',
        normalizeLoudness: false,
        mixTuning: DEFAULT_MIX_TUNING
      }
    );

    expect(plan.track.targetBpm).toBe(120);
    expect(plan.track.metronomeBpm).toBe(180);
  });
});

describe('buildMedleyExportPlan', () => {
  test('creates medley with clip list', () => {
    const project: ProjectFile = {
      version: 1,
      meta: {
        id: 'p1',
        name: 'Project',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      globalTargetBpm: 180,
      timeSignature: '4/4',
      defaultMetronomeSamplePath: '',
      theme: 'light',
      language: 'zh-CN',
      tracks: [track],
      exportPreset: {
        mode: 'medley',
        format: 'wav',
        sampleRate: 48000,
        bitrateKbps: 320,
        outputDir: '',
        fileSuffix: '',
        normalizeLoudness: false,
        gapMs: 0,
        crossfadeMs: 0
      },
      mixTuning: {
        ...DEFAULT_MIX_TUNING
      }
    };
    const plan = buildMedleyExportPlan(project, {
      globalTargetBpm: project.globalTargetBpm,
      outputDir: 'C:/exports',
      format: 'mp3',
      metronomeSamplePath: '',
      normalizeLoudness: false,
      gapMs: 300,
      crossfadeMs: 200,
      mixTuning: project.mixTuning
    });
    expect(plan.clips).toHaveLength(1);
  });
});

describe('buildOutputFileName', () => {
  test('composes suffix with bpm and metronome tags', () => {
    const file = buildOutputFileName(
      {
        name: 'track.wav',
        sourceBpm: 174,
        targetBpm: 180,
        metronomeEnabled: true
      },
      'single',
      {
        includeBpm: true,
        includeMetronomeTag: true,
        customSuffix: 'ready'
      }
    );
    expect(file).toContain('bpm180');
    expect(file).toContain('metronome');
    expect(file).toContain('ready');
  });
});
