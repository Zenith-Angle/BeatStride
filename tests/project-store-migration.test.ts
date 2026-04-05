import { beforeEach, describe, expect, test } from 'vitest';
import { DEFAULT_EXPORT_PRESET, DEFAULT_MIX_TUNING } from '../src/shared/constants';
import type { ProjectFile } from '../src/shared/types';
import { useProjectStore } from '../src/renderer/src/stores/projectStore';

function resetProjectStore(): void {
  useProjectStore.getState().setProject(null);
  useProjectStore.setState({
    libraryCheckedIds: [],
    activeTimelineTrackId: null,
    undoStack: [],
    redoStack: [],
    dirty: false
  });
}

describe('projectStore migration', () => {
  beforeEach(() => {
    resetProjectStore();
  });

  test('migrates legacy project meter settings onto tracks', () => {
    const legacyProject = {
      version: 1,
      meta: {
        id: 'legacy-project',
        name: 'Legacy',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      globalTargetBpm: 180,
      timeSignature: '6/8',
      defaultMetronomeSamplePath: '',
      theme: 'light',
      language: 'zh-CN',
      exportPreset: {
        ...DEFAULT_EXPORT_PRESET
      },
      mixTuning: {
        ...DEFAULT_MIX_TUNING,
        beatsPerBar: 6
      },
      tracks: [
        {
          id: 't1',
          name: 'legacy.mp3',
          filePath: 'C:/music/legacy.mp3',
          durationMs: 120000,
          sampleRate: 44100,
          channels: 2,
          detectedBpm: 150,
          sourceBpm: 150,
          targetBpm: undefined,
          speedRatio: 1,
          downbeatOffsetMs: 240,
          metronomeOffsetMs: 0,
          trackStartMs: 0,
          trimInMs: 0,
          trimOutMs: 0,
          fadeInMs: 0,
          fadeOutMs: 0,
          volumeDb: 0,
          pan: 0,
          metronomeEnabled: true,
          metronomeVolumeDb: -8,
          exportEnabled: true,
          inTimeline: true
        }
      ]
    } as unknown as ProjectFile;

    useProjectStore.getState().setProject(legacyProject);

    const track = useProjectStore.getState().project?.tracks[0];
    expect(track?.beatsPerBar).toBe(6);
    expect(track?.timeSignature).toBe('6/8');
    expect(track?.accentPattern).toEqual([1.35, 1, 1, 1.15, 1, 1]);
    expect(track?.analysisConfidence).toBe(0.5);
    expect(track?.meterConfidence).toBe(0);
  });
});
