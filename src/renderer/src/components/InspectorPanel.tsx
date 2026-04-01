import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ProjectFile, Track } from '@shared/types';
import { useI18n } from '@renderer/features/i18n/I18nProvider';
import { AlignmentPanel } from '@renderer/features/alignment/AlignmentPanel';
import { alignMetronomeToDownbeat } from '@shared/services/alignmentService';

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
    ? alignMetronomeToDownbeat(track, {
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
      const result = await window.beatStride.detectTempo(
        track.filePath,
        project.mixTuning.analysisSeconds,
        project.mixTuning.beatsPerBar
      );
      if (result.bpm > 0) {
        onUpdateTrack(track.id, {
          detectedBpm: result.bpm,
          sourceBpm: result.bpm,
          downbeatOffsetMs: result.downbeatOffsetMs
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
        <strong>处理参数</strong>
      </div>
      <div ref={splitRootRef} className="inspector-split no-drag">
        <div
          className="panel-content inspector-top"
          style={{ height: topHeight, borderBottom: '1px solid var(--line)' }}
        >
          <h4 style={{ margin: 0, marginBottom: 10 }}>全局节奏基准</h4>
          <div className="properties-grid">
            <label className="field inline">
              <span>全局目标 BPM</span>
              <input
                type="number"
                value={project.globalTargetBpm}
                onChange={(event) =>
                  onUpdateProject({ globalTargetBpm: Number(event.target.value) || 180 })
                }
              />
            </label>
            <label className="field inline">
              <span>每小节拍数</span>
              <input
                type="number"
                min={1}
                value={project.mixTuning.beatsPerBar}
                onChange={(event) =>
                  updateMixTuning('beatsPerBar', Math.max(1, Number(event.target.value) || 4))
                }
              />
            </label>
            <label className="field">
              <span>默认节拍器音色</span>
              <input
                value={project.defaultMetronomeSamplePath}
                onChange={(event) =>
                  onUpdateProject({ defaultMetronomeSamplePath: event.target.value })
                }
              />
            </label>
            <label className="field inline">
              <span>默认拍号</span>
              <input value={project.timeSignature} disabled />
            </label>
            {track && trackAlignment ? (
              <div className="inspector-summary-card">
                <strong>{track.name}</strong>
                <span>
                  {Math.round(trackAlignment.sourceBpm)} → {Math.round(trackAlignment.effectiveSourceBpm)} →{' '}
                  {Math.round(trackAlignment.targetBpm)} BPM
                </span>
                <span>映射模式: {trackAlignment.harmonicMode}</span>
              </div>
            ) : (
              <p className="muted inspector-summary-card">选中工作区歌曲后，这里会显示实际映射结果。</p>
            )}
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              自动分析会优先估计 BPM 和首拍位置；下半区域只保留少量保底微调。
            </p>
          </div>
        </div>
        <div
          className={`row-splitter ${resizing ? 'active' : ''}`}
          onMouseDown={() => setResizing(true)}
        />
        <div className="panel-content inspector-bottom">
          <h4 style={{ margin: 0, marginBottom: 10 }}>微调面板</h4>
          <div className="inspector-section-grid">
            <section className="inspector-form-section">
              <strong>自动对齐与节拍器</strong>
              <div className="properties-grid">
                <label className="field db-slider-field">
                  <FieldLabel
                    text="拍子增益(dB)"
                    help="控制叠加到歌曲上的节拍器整体音量。默认 0 dB，可在 -10 dB 到 10 dB 之间微调。"
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
              <strong>转场与响度</strong>
              <div className="properties-grid">
                <label className="field inline">
                  <FieldLabel
                    text="过渡小节"
                    help="串烧导出时，每两首歌交叉过渡持续多少个小节。当前主要影响串烧导出，不影响单曲导出。"
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
                    text="过渡 Duck(dB)"
                    help="交叉过渡时两边一起压低多少音量，避免转场区域峰值堆叠和听感发闷。"
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
                    text="Headroom(dB)"
                    help="最终输出前统一预留的余量，防止响度处理和叠加节拍器后出现削顶。"
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
                    text="启用 loudnorm"
                    help="开启后导出阶段会做响度一致化。适合串烧，但会增加处理时间。"
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
                    text="目标 LUFS"
                    help="整体响度目标。数值越接近 0 越响。"
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
                    text="目标 LRA"
                    help="允许保留的响度动态范围。数值越大，歌曲动态起伏越明显。"
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
                    text="目标 TP"
                    help="true peak 上限，限制输出峰值。常见安全值为 -1 dBTP。"
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
            <p className="muted" style={{ marginTop: 16 }}>{t('status.noTrackSelected')}</p>
          )}
        </div>
      </div>
    </aside>
  );
}
