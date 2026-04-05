import { beforeEach, describe, expect, test, vi } from 'vitest';
import { TrackAnalysisService } from '../src/main/services/trackAnalysisService';

const { detectTempoMock, alignMetronomeToDownbeatMock } = vi.hoisted(() => ({
  detectTempoMock: vi.fn(),
  alignMetronomeToDownbeatMock: vi.fn()
}));

vi.mock('../src/main/services/tempoDetectionService', () => ({
  detectTempo: detectTempoMock
}));

vi.mock('../src/shared/services/alignmentService', () => ({
  alignMetronomeToDownbeat: alignMetronomeToDownbeatMock
}));

describe('TrackAnalysisService', () => {
  beforeEach(() => {
    detectTempoMock.mockReset();
    alignMetronomeToDownbeatMock.mockReset();
  });

  test('falls back to TS tempo detection when analyzer fails', async () => {
    const service = new TrackAnalysisService({
      analyzeTracks: vi.fn().mockRejectedValue(new Error('sidecar failed')),
      suggestTrackAlignments: vi.fn()
    });

    detectTempoMock.mockResolvedValue({
      filePath: 'C:/music/a.mp3',
      bpm: 180,
      firstBeatMs: 120,
      downbeatOffsetMs: 120,
      beatsPerBar: 4,
      timeSignature: '4/4',
      analysisConfidence: 0.92,
      meterConfidence: 0.81,
      accentPattern: [1.35, 1, 1, 1]
    });

    const results = await service.analyzeTracks(
      {
        tracks: [{ filePath: 'C:/music/a.mp3' }],
        analysisSeconds: 120
      },
      'C:/ffmpeg/ffmpeg.exe'
    );

    expect(detectTempoMock).toHaveBeenCalledOnce();
    expect(results[0]?.timeSignature).toBe('4/4');
  });

  test('falls back to shared alignment rules when analyzer suggestions fail', async () => {
    const service = new TrackAnalysisService({
      analyzeTracks: vi.fn(),
      suggestTrackAlignments: vi.fn().mockRejectedValue(new Error('sidecar failed'))
    });

    alignMetronomeToDownbeatMock.mockReturnValue({
      targetBpm: 120,
      sourceBpm: 110,
      effectiveSourceBpm: 110,
      speedRatio: 120 / 110,
      downbeatOffsetMsAfterSpeed: 200,
      metronomeStartMs: 200,
      harmonicMode: 'comfort-target->120 / direct'
    });

    const results = await service.suggestTrackAlignments({
      tracks: [
        {
          filePath: 'C:/music/a.mp3',
          bpm: 110,
          downbeatOffsetMs: 220,
          beatsPerBar: 4,
          timeSignature: '4/4'
        }
      ],
      globalTargetBpm: 180,
      mixTuning: {
        harmonicTolerance: 0.12,
        harmonicMappingEnabled: true,
        halfMapUpperBpm: 110
      }
    });

    expect(alignMetronomeToDownbeatMock).toHaveBeenCalledOnce();
    expect(results[0]?.recommendedTargetBpm).toBe(120);
    expect(results[0]?.harmonicMode).toContain('comfort-target->120');
  });
});
