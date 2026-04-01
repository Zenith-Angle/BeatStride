import type { Track } from '@shared/types';
import { useI18n } from '@renderer/features/i18n/I18nProvider';
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
      <div className="inspector-summary-card">
        <strong>{track.name}</strong>
        <span>
          {Math.round(aligned.sourceBpm)} → {Math.round(aligned.effectiveSourceBpm)} →{' '}
          {Math.round(aligned.targetBpm)} BPM
        </span>
        <span>自动映射: {aligned.harmonicMode}</span>
      </div>
      <div className="properties-grid">
        <label className="field inline">
          <span>自动首拍后偏移</span>
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
          {analyzingTempo ? '分析中...' : '重新分析并自动对齐'}
        </button>
      </div>
      <p className="muted alignment-result">
        自动分析会优先更新 BPM 和首拍偏移；如果还有细小误差，再手动改上面两个偏移。
      </p>
    </div>
  );
}
