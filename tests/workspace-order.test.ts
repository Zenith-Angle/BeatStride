import { describe, expect, test } from 'vitest';
import type { Track } from '../src/shared/types';
import {
  getWorkspaceTracks,
  moveWorkspaceTrack,
  reorderWorkspaceTrack
} from '../src/shared/services/workspaceOrderService';

function createTrack(
  id: string,
  name: string,
  exportEnabled: boolean
): Track {
  return {
    id,
    name,
    filePath: `C:/music/${name}.mp3`,
    durationMs: 1000,
    sampleRate: 44100,
    channels: 2,
    detectedBpm: 180,
    sourceBpm: 180,
    targetBpm: 180,
    speedRatio: 1,
    downbeatOffsetMs: 0,
    metronomeOffsetMs: 0,
    beatsPerBar: 4,
    timeSignature: '4/4',
    analysisConfidence: 0.9,
    meterConfidence: 0.85,
    accentPattern: [1.35, 1, 1, 1],
    trackStartMs: 0,
    trimInMs: 0,
    trimOutMs: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    volumeDb: 0,
    pan: 0,
    metronomeEnabled: true,
    metronomeVolumeDb: -8,
    exportEnabled,
    inTimeline: exportEnabled
  };
}

describe('workspaceOrderService', () => {
  test('returns workspace tracks in display order', () => {
    const tracks = [
      createTrack('p1', 'pending-1', false),
      createTrack('w1', 'work-1', true),
      createTrack('p2', 'pending-2', false),
      createTrack('w2', 'work-2', true)
    ];

    expect(getWorkspaceTracks(tracks).map((track) => track.id)).toEqual(['w1', 'w2']);
  });

  test('moves workspace track up and keeps pending order intact', () => {
    const tracks = [
      createTrack('p1', 'pending-1', false),
      createTrack('p2', 'pending-2', false),
      createTrack('w1', 'work-1', true),
      createTrack('w2', 'work-2', true),
      createTrack('w3', 'work-3', true)
    ];

    const next = moveWorkspaceTrack(tracks, 'w3', 'up');
    expect(next?.map((track) => track.id)).toEqual(['p1', 'p2', 'w1', 'w3', 'w2']);
  });

  test('reorders workspace tracks by drag placement', () => {
    const tracks = [
      createTrack('p1', 'pending-1', false),
      createTrack('w1', 'work-1', true),
      createTrack('w2', 'work-2', true),
      createTrack('w3', 'work-3', true)
    ];

    const next = reorderWorkspaceTrack(tracks, 'w1', 'w3', 'after');
    expect(next?.map((track) => track.id)).toEqual(['p1', 'w2', 'w3', 'w1']);
  });
});
