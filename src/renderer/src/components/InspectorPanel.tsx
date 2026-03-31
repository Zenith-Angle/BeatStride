import { useEffect, useRef, useState } from 'react';
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
        project.mixTuning.analysisSeconds
      );
      if (result.bpm > 0) {
        onUpdateTrack(track.id, {
          detectedBpm: result.bpm,
          sourceBpm: result.bpm
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
              上半区域保留全局基准；下半区域改为脚本同源的微调参数。
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
              <strong>节拍与变速</strong>
              <div className="properties-grid">
                <label className="field inline">
                  <FieldLabel
                    text="分析时长(s)"
                    help="导入歌曲或手动重分析 BPM 时，会只分析前多少秒；设为 0 或更大值会增加分析时间。"
                  />
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={project.mixTuning.analysisSeconds}
                    onChange={(event) =>
                      updateMixTuning('analysisSeconds', Math.max(0, Number(event.target.value) || 0))
                    }
                  />
                </label>
                <label className="field inline">
                  <FieldLabel
                    text="变速引擎"
                    help="auto 会优先尝试 rubberband，失败时退回 atempo。该项影响试听与导出的变速质量和兼容性。"
                  />
                  <select
                    value={project.mixTuning.stretchEngine}
                    onChange={(event) =>
                      updateMixTuning('stretchEngine', event.target.value as ProjectFile['mixTuning']['stretchEngine'])
                    }
                  >
                    <option value="auto">auto</option>
                    <option value="rubberband">rubberband</option>
                    <option value="atempo">atempo</option>
                  </select>
                </label>
                <label className="field inline">
                  <FieldLabel
                    text="拍子渲染"
                    help="crisp-click 会生成更干脆的 click；sampled-click 更柔和；stretched-file 会把节拍器素材整段拉伸到目标 BPM。"
                  />
                  <select
                    value={project.mixTuning.beatRenderMode}
                    onChange={(event) =>
                      updateMixTuning('beatRenderMode', event.target.value as ProjectFile['mixTuning']['beatRenderMode'])
                    }
                  >
                    <option value="crisp-click">crisp-click</option>
                    <option value="sampled-click">sampled-click</option>
                    <option value="stretched-file">stretched-file</option>
                  </select>
                </label>
                <label className="field inline">
                  <FieldLabel
                    text="拍子增益(dB)"
                    help="控制叠加到歌曲上的节拍器整体音量。数值越大，导出时 click 越明显。"
                  />
                  <input
                    type="number"
                    step={0.5}
                    value={project.mixTuning.beatGainDb}
                    onChange={(event) =>
                      updateMixTuning('beatGainDb', Number(event.target.value) || 0)
                    }
                  />
                </label>
                <label className="field inline">
                  <FieldLabel
                    text="拍子素材 BPM"
                    help="当前节拍器素材原始录制的 BPM。只有 stretched-file 模式会直接依赖这个值。"
                  />
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={project.mixTuning.beatOriginalBpm}
                    onChange={(event) =>
                      updateMixTuning('beatOriginalBpm', Math.max(1, Number(event.target.value) || 180))
                    }
                  />
                </label>
                <label className="field inline">
                  <FieldLabel
                    text="映射容差"
                    help="判断检测到的 BPM 是否应该按 half-time 或 double-time 解释的容差。值越大，系统越容易把 90 识别成 180 网格。"
                  />
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={project.mixTuning.harmonicTolerance}
                    onChange={(event) =>
                      updateMixTuning('harmonicTolerance', Math.max(0, Number(event.target.value) || 0))
                    }
                  />
                </label>
                <label className="field inline">
                  <FieldLabel
                    text="Half-time 阈值"
                    help="当检测 BPM 小于等于这个值时，会优先尝试按半拍解释，再映射到全局目标 BPM。"
                  />
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={project.mixTuning.halfMapUpperBpm}
                    onChange={(event) =>
                      updateMixTuning('halfMapUpperBpm', Math.max(0, Number(event.target.value) || 0))
                    }
                  />
                </label>
                <label className="field inline checkbox-field">
                  <FieldLabel
                    text="启用半拍/倍拍映射"
                    help="开启后，系统会自动把 90/180、87/174 这类常见 half-time / double-time 关系折算到目标网格。"
                  />
                  <input
                    type="checkbox"
                    checked={project.mixTuning.harmonicMappingEnabled}
                    onChange={(event) =>
                      updateMixTuning('harmonicMappingEnabled', event.target.checked)
                    }
                  />
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
