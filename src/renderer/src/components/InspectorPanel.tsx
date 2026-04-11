import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ProjectFile, Track } from '@shared/types';
import { useI18n } from '@renderer/features/i18n/I18nProvider';
import { AlignmentPanel } from '@renderer/features/alignment/AlignmentPanel';
import { resolveTrackAlignment } from '@shared/services/alignmentService';

interface InspectorPanelProps {
  project: ProjectFile;
  track?: Track;
  onUpdateProject: (patch: Partial<ProjectFile>) => void;
  onUpdateTrack: (trackId: string, patch: Partial<Track>) => void;
}

function FieldLabel({ text, help }: { text: string; help?: string }) {
  return (
    <span className="field-label-with-help">
      <span>{text}</span>
      {help && (
        <button type="button" className="help-hint" title={help} aria-label={help}>
          ?
        </button>
      )}
    </span>
  );
}

export function InspectorPanel({
  project,
  track,
  onUpdateProject,
  onUpdateTrack
}: InspectorPanelProps) {
  const { t } = useI18n();
  const splitRootRef = useRef<HTMLDivElement | null>(null);
  const [topHeight, setTopHeight] = useState(290);
  const [resizing, setResizing] = useState(false);
  const [analyzingTempo, setAnalyzingTempo] = useState(false);
  const trackAlignment = track
    ? resolveTrackAlignment(track, {
        globalTargetBpm: project.globalTargetBpm,
        harmonicTolerance: project.mixTuning.harmonicTolerance,
        harmonicMappingEnabled: project.mixTuning.harmonicMappingEnabled,
        halfMapUpperBpm: project.mixTuning.halfMapUpperBpm
      })
    : null;

  const updateMixTuning = <K extends keyof ProjectFile['mixTuning']>(
    key: K,
    value: ProjectFile['mixTuning'][K]
  ) => {
    onUpdateProject({
      mixTuning: {
        ...project.mixTuning,
        [key]: value
      }
    });
  };

  const analyzeSelectedTrackTempo = async () => {
    if (!track) {
      return;
    }
    setAnalyzingTempo(true);
    try {
      const [analysis] = await window.beatStride.analyzeTracks({
        tracks: [{ filePath: track.filePath }],
        analysisSeconds: project.mixTuning.analysisSeconds
      });
      if (analysis && analysis.bpm > 0) {
        const [suggestion] = await window.beatStride.suggestTrackAlignments({
          tracks: [
            {
              filePath: track.filePath,
              bpm: analysis.bpm,
              targetBpm: track.targetBpm,
              downbeatOffsetMs: analysis.downbeatOffsetMs,
              beatsPerBar: analysis.beatsPerBar,
              timeSignature: analysis.timeSignature
            }
          ],
          globalTargetBpm: project.globalTargetBpm,
          mixTuning: {
            harmonicTolerance: project.mixTuning.harmonicTolerance,
            harmonicMappingEnabled: project.mixTuning.harmonicMappingEnabled,
            halfMapUpperBpm: project.mixTuning.halfMapUpperBpm
          }
        });
        onUpdateTrack(track.id, {
          detectedBpm: analysis.bpm,
          sourceBpm: analysis.bpm,
          downbeatOffsetMs: analysis.downbeatOffsetMs,
          beatsPerBar: analysis.beatsPerBar,
          timeSignature: analysis.timeSignature,
          analysisConfidence: analysis.analysisConfidence,
          meterConfidence: analysis.meterConfidence,
          accentPattern: analysis.accentPattern,
          alignmentSuggestion: suggestion
            ? {
                recommendedTargetBpm: suggestion.recommendedTargetBpm,
                effectiveSourceBpm: suggestion.effectiveSourceBpm,
                speedRatio: suggestion.speedRatio,
                harmonicMode: suggestion.harmonicMode,
                downbeatOffsetMsAfterSpeed: suggestion.downbeatOffsetMsAfterSpeed,
                recommendedMetronomeStartMs: suggestion.recommendedMetronomeStartMs
              }
            : undefined
        });
      }
    } finally {
      setAnalyzingTempo(false);
    }
  };

  useEffect(() => {
    if (!resizing) {
      return;
    }
    const handleMove = (event: MouseEvent) => {
      const root = splitRootRef.current;
      if (!root) {
        return;
      }
      const rect = root.getBoundingClientRect();
      const splitter = 8;
      const minTop = 180;
      const minBottom = 180;
      const rawTop = event.clientY - rect.top;
      const maxTop = rect.height - splitter - minBottom;
      const next = Math.max(minTop, Math.min(maxTop, rawTop));
      setTopHeight(next);
    };
    const handleUp = () => setResizing(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [resizing]);

  return (
    <aside className="panel">
      <div className="panel-header">
        <strong>{t('inspector.processingTitle')}</strong>
      </div>
      <div ref={splitRootRef} className="inspector-split no-drag">
        <div
          className="panel-content inspector-top inspector-top-pane"
          style={{ height: topHeight }}
        >
          <h4 className="inspector-section-title">{t('inspector.globalRhythmTitle')}</h4>
          <div className="properties-grid">
            <label className="field inline">
              <span>{t('inspector.globalTargetBpm')}</span>
              <input
                type="number"
                value={project.globalTargetBpm}
                onChange={(event) =>
                  onUpdateProject({ globalTargetBpm: Number(event.target.value) || 180 })
                }
              />
            </label>
            <label className="field">
              <span>{t('inspector.defaultMetronome')}</span>
              <input
                value={project.defaultMetronomeSamplePath}
                onChange={(event) =>
                  onUpdateProject({ defaultMetronomeSamplePath: event.target.value })
                }
              />
            </label>
            {track && trackAlignment ? (
              <div className="inspector-summary-card">
                <strong>{track.name}</strong>
                <span>
                  {Math.round(trackAlignment.sourceBpm)} → {Math.round(trackAlignment.effectiveSourceBpm)} →{' '}
                  {Math.round(trackAlignment.targetBpm)} BPM
                </span>
                <span>
                  {t('alignment.timeSignature')}
                  {track.timeSignature} · {t('alignment.detectConfidence')}
                  {Math.round(track.analysisConfidence * 100)}% · {t('inspector.meterConfidence')}
                  {Math.round(track.meterConfidence * 100)}%
                </span>
                <span>
                  {t('inspector.mappingMode')}
                  {trackAlignment.harmonicMode}
                </span>
              </div>
            ) : (
              <p className="muted inspector-summary-card">{t('inspector.summaryEmpty')}</p>
            )}
            <p className="muted inspector-note">
              {t('inspector.summaryNote')}
            </p>
          </div>
        </div>
        <div
          className={`row-splitter ${resizing ? 'active' : ''}`}
          onMouseDown={() => setResizing(true)}
        />
        <div className="panel-content inspector-bottom">
          <h4 className="inspector-section-title">{t('inspector.fineTuneTitle')}</h4>
          <div className="inspector-section-grid">
            <section className="inspector-form-section">
              <strong>{t('inspector.autoAlignSection')}</strong>
              <div className="properties-grid">
                <label className="field db-slider-field">
                  <FieldLabel
                    text={t('inspector.beatGain')}
                    help={t('inspector.beatGainHelp')}
                  />
                  <div className="db-slider-row">
                    <span className="db-slider-boundary">-10</span>
                    <input
                      className="db-slider-input"
                      type="range"
                      min={-10}
                      max={10}
                      step={0.5}
                      value={project.mixTuning.beatGainDb}
                      style={
                        {
                          '--slider-percent': `${((project.mixTuning.beatGainDb + 10) / 20) * 100}%`
                        } as CSSProperties
                      }
                      onChange={(event) =>
                        updateMixTuning('beatGainDb', Number(event.target.value) || 0)
                      }
                    />
                    <span className="db-slider-boundary">10</span>
                    <strong className="db-slider-value">
                      {project.mixTuning.beatGainDb > 0 ? '+' : ''}
                      {project.mixTuning.beatGainDb.toFixed(1)} dB
                    </strong>
                  </div>
                </label>
              </div>
            </section>

            <section className="inspector-form-section">
              <strong>{t('inspector.transitionSection')}</strong>
              <div className="properties-grid">
                <label className="field inline">
                  <FieldLabel
                    text={t('inspector.transitionBars')}
                    help={t('inspector.transitionBarsHelp')}
                  />
                  <input
                    type="number"
                    min={0}
                    step={0.25}
                    value={project.mixTuning.transitionBars}
                    onChange={(event) =>
                      updateMixTuning('transitionBars', Math.max(0, Number(event.target.value) || 0))
                    }
                  />
                </label>
                <label className="field inline">
                  <FieldLabel
                    text={t('inspector.transitionDuck')}
                    help={t('inspector.transitionDuckHelp')}
                  />
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={project.mixTuning.transitionDuckDb}
                    onChange={(event) =>
                      updateMixTuning('transitionDuckDb', Math.max(0, Number(event.target.value) || 0))
                    }
                  />
                </label>
                <label className="field inline">
                  <FieldLabel
                    text={t('inspector.headroom')}
                    help={t('inspector.headroomHelp')}
                  />
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={project.mixTuning.headroomDb}
                    onChange={(event) =>
                      updateMixTuning('headroomDb', Math.max(0, Number(event.target.value) || 0))
                    }
                  />
                </label>
                <label className="field inline checkbox-field">
                  <FieldLabel
                    text={t('inspector.enableLoudnorm')}
                    help={t('inspector.enableLoudnormHelp')}
                  />
                  <input
                    type="checkbox"
                    checked={project.mixTuning.loudnormEnabled}
                    onChange={(event) =>
                      updateMixTuning('loudnormEnabled', event.target.checked)
                    }
                  />
                </label>
                <label className="field inline">
                  <FieldLabel
                    text={t('inspector.targetLufs')}
                    help={t('inspector.targetLufsHelp')}
                  />
                  <input
                    type="number"
                    step={0.1}
                    value={project.mixTuning.targetLufs}
                    onChange={(event) =>
                      updateMixTuning('targetLufs', Number(event.target.value) || 0)
                    }
                  />
                </label>
                <label className="field inline">
                  <FieldLabel
                    text={t('inspector.targetLra')}
                    help={t('inspector.targetLraHelp')}
                  />
                  <input
                    type="number"
                    min={1}
                    step={0.1}
                    value={project.mixTuning.targetLra}
                    onChange={(event) =>
                      updateMixTuning('targetLra', Math.max(1, Number(event.target.value) || 1))
                    }
                  />
                </label>
                <label className="field inline">
                  <FieldLabel
                    text={t('inspector.targetTp')}
                    help={t('inspector.targetTpHelp')}
                  />
                  <input
                    type="number"
                    step={0.1}
                    value={project.mixTuning.targetTp}
                    onChange={(event) =>
                      updateMixTuning('targetTp', Number(event.target.value) || 0)
                    }
                  />
                </label>
              </div>
            </section>
          </div>

          {track ? (
            <AlignmentPanel
              track={track}
              globalTargetBpm={project.globalTargetBpm}
              onUpdate={(patch) => onUpdateTrack(track.id, patch)}
              onAnalyzeTempo={analyzeSelectedTrackTempo}
              analyzingTempo={analyzingTempo}
            />
          ) : (
            <p className="muted inspector-empty-tip">{t('status.noTrackSelected')}</p>
          )}
        </div>
      </div>
    </aside>
  );
}
