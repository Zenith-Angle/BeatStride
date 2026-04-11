import type { Track } from '@shared/types';
import { useI18n } from '@renderer/features/i18n/I18nProvider';
import { resolveTrackAlignment } from '@shared/services/alignmentService';

interface AlignmentPanelProps {
  track: Track;
  globalTargetBpm: number;
  onUpdate: (patch: Partial<Track>) => void;
  onAnalyzeTempo?: () => void | Promise<void>;
  analyzingTempo?: boolean;
}

export function AlignmentPanel({
  track,
  globalTargetBpm,
  onUpdate,
  onAnalyzeTempo,
  analyzingTempo = false
}: AlignmentPanelProps) {
  const { t } = useI18n();
  const aligned = resolveTrackAlignment(track, {
    globalTargetBpm,
    harmonicMappingEnabled: true
  });

  const nudge = (deltaMs: number) => {
    onUpdate({ metronomeOffsetMs: track.metronomeOffsetMs + deltaMs });
  };

  const beatMs = 60000 / aligned.targetBpm;
  return (
    <div className="panel-content no-drag alignment-panel">
      <h4>{t('alignment.title')}</h4>
      <div className="inspector-summary-card">
        <strong>{track.name}</strong>
        <span>
          {Math.round(aligned.sourceBpm)} → {Math.round(aligned.effectiveSourceBpm)} →{' '}
          {Math.round(aligned.targetBpm)} BPM
        </span>
        <span>
          {t('alignment.timeSignature')}
          {track.timeSignature} · {t('alignment.detectConfidence')}
          {Math.round(track.analysisConfidence * 100)}%
        </span>
        <span>
          {t('alignment.autoMapping')}
          {aligned.harmonicMode}
        </span>
      </div>
      <div className="properties-grid">
        <label className="field inline">
          <span>{t('alignment.autoDownbeatAfterSpeed')}</span>
          <div className="alignment-readonly-value">
            {Math.round(aligned.downbeatOffsetMsAfterSpeed)} ms
          </div>
        </label>
        <label className="field inline">
          <span>{t('alignment.downbeatOffset')}</span>
          <input
            type="number"
            value={track.downbeatOffsetMs}
            onChange={(event) =>
              onUpdate({ downbeatOffsetMs: Number(event.target.value) || 0 })
            }
          />
        </label>
        <label className="field inline">
          <span>{t('alignment.metronomeOffset')}</span>
          <input
            type="number"
            value={track.metronomeOffsetMs}
            onChange={(event) =>
              onUpdate({ metronomeOffsetMs: Number(event.target.value) || 0 })
            }
          />
        </label>
      </div>
      <div className="alignment-action-grid">
        <button onClick={() => nudge(-beatMs)}>{t('alignment.nudgeBeatLeft')}</button>
        <button onClick={() => nudge(beatMs)}>{t('alignment.nudgeBeatRight')}</button>
        <button onClick={() => nudge(-10)}>{t('alignment.nudge10msLeft')}</button>
        <button onClick={() => nudge(10)}>{t('alignment.nudge10msRight')}</button>
      </div>
      <div className="alignment-action-grid compact">
        <button onClick={() => void onAnalyzeTempo?.()} disabled={analyzingTempo}>
          {analyzingTempo ? t('common.loading') : t('alignment.reanalyze')}
        </button>
      </div>
      <p className="muted alignment-result">
        {t('alignment.resultHint')}
      </p>
    </div>
  );
}
