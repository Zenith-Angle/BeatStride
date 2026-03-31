import type { Track } from '@shared/types';
import { useI18n } from '@renderer/features/i18n/I18nProvider';
import { useTapTempo } from '@renderer/hooks/useTapTempo';
import { alignMetronomeToDownbeat } from '@shared/services/alignmentService';

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
  const { bpm, tap, reset } = useTapTempo();
  const aligned = alignMetronomeToDownbeat(track, {
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
      <div className="properties-grid">
        <label className="field inline">
          <span>{t('alignment.sourceBpm')}</span>
          <input
            type="number"
            value={track.sourceBpm}
            onChange={(event) => onUpdate({ sourceBpm: Number(event.target.value) })}
          />
        </label>
        <label className="field inline">
          <span>{t('alignment.targetBpm')}</span>
          <input
            type="number"
            value={track.targetBpm ?? ''}
            placeholder={String(aligned.targetBpm)}
            onChange={(event) =>
              onUpdate({
                targetBpm: event.target.value ? Number(event.target.value) : undefined
              })
            }
          />
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
        <button onClick={() => nudge(-beatMs / 2)}>{t('alignment.nudgeHalfLeft')}</button>
        <button onClick={() => nudge(beatMs / 2)}>{t('alignment.nudgeHalfRight')}</button>
        <button onClick={() => nudge(-10)}>{t('alignment.nudge10msLeft')}</button>
        <button onClick={() => nudge(10)}>{t('alignment.nudge10msRight')}</button>
        <button onClick={() => nudge(-50)}>{t('alignment.nudge50msLeft')}</button>
        <button onClick={() => nudge(50)}>{t('alignment.nudge50msRight')}</button>
      </div>
      <div className="alignment-action-grid compact">
        <button onClick={() => void onAnalyzeTempo?.()} disabled={analyzingTempo}>
          {analyzingTempo ? '分析中...' : '重新分析 BPM'}
        </button>
        <button onClick={tap}>{t('alignment.tapTempo')}</button>
        <button
          onClick={() => {
            if (bpm) {
              onUpdate({ sourceBpm: bpm });
            }
            reset();
          }}
        >
          {t('common.apply')}
        </button>
      </div>
      {bpm && <p className="muted alignment-result">{bpm} BPM</p>}
    </div>
  );
}
