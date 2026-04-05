import type {
  MixTuningSettings,
  TimeSignature,
  TrackAlignmentSuggestionResult,
  TrackAnalysisResult
} from '@shared/types';
import { alignMetronomeToDownbeat } from '@shared/services/alignmentService';
import { AnalyzerService } from './analyzerService';
import { detectTempo } from './tempoDetectionService';

interface AnalyzerLike {
  analyzeTracks(
    payload: {
      tracks: Array<{ filePath: string }>;
      analysisSeconds: number;
    },
    ffmpegPath?: string
  ): Promise<TrackAnalysisResult[]>;
  suggestTrackAlignments(payload: {
    tracks: Array<{
      filePath: string;
      bpm: number;
      targetBpm?: number;
      downbeatOffsetMs: number;
      beatsPerBar: number;
      timeSignature: TimeSignature;
    }>;
    globalTargetBpm: number;
    mixTuning: Pick<
      MixTuningSettings,
      'harmonicTolerance' | 'harmonicMappingEnabled' | 'halfMapUpperBpm'
    >;
  }): Promise<TrackAlignmentSuggestionResult[]>;
}

export class TrackAnalysisService {
  constructor(private readonly analyzer: AnalyzerLike = new AnalyzerService()) {}

  async analyzeTracks(
    payload: {
      tracks: Array<{ filePath: string }>;
      analysisSeconds: number;
    },
    ffmpegPath?: string
  ): Promise<TrackAnalysisResult[]> {
    try {
      return await this.analyzer.analyzeTracks(payload, ffmpegPath);
    } catch {
      if (!ffmpegPath) {
        throw new Error('analyzer unavailable and ffmpeg fallback not available');
      }
      return Promise.all(
        payload.tracks.map((track) => detectTempo(ffmpegPath, track.filePath, payload.analysisSeconds))
      );
    }
  }

  async suggestTrackAlignments(payload: {
    tracks: Array<{
      filePath: string;
      bpm: number;
      targetBpm?: number;
      downbeatOffsetMs: number;
      beatsPerBar: number;
      timeSignature: TimeSignature;
    }>;
    globalTargetBpm: number;
    mixTuning: Pick<
      MixTuningSettings,
      'harmonicTolerance' | 'harmonicMappingEnabled' | 'halfMapUpperBpm'
    >;
  }): Promise<TrackAlignmentSuggestionResult[]> {
    try {
      return await this.analyzer.suggestTrackAlignments(payload);
    } catch {
      return payload.tracks.map((track) => {
        const aligned = alignMetronomeToDownbeat(
          {
            sourceBpm: track.bpm,
            detectedBpm: track.bpm,
            targetBpm: track.targetBpm,
            downbeatOffsetMs: track.downbeatOffsetMs,
            metronomeOffsetMs: 0
          },
          {
            globalTargetBpm: payload.globalTargetBpm,
            harmonicTolerance: payload.mixTuning.harmonicTolerance,
            harmonicMappingEnabled: payload.mixTuning.harmonicMappingEnabled,
            halfMapUpperBpm: payload.mixTuning.halfMapUpperBpm
          }
        );
        return {
          filePath: track.filePath,
          recommendedTargetBpm: aligned.targetBpm,
          effectiveSourceBpm: aligned.effectiveSourceBpm,
          speedRatio: aligned.speedRatio,
          harmonicMode: aligned.harmonicMode,
          downbeatOffsetMsAfterSpeed: aligned.downbeatOffsetMsAfterSpeed,
          recommendedMetronomeStartMs: aligned.metronomeStartMs
        };
      });
    }
  }
}
