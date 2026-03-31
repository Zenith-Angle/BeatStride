import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type SyntheticEvent } from 'react';
import type { ProjectFile, Track, TrackProxyStatus } from '@shared/types';
import { buildProjectPreviewPlan, buildSingleTrackPreviewPlan } from '@shared/services/previewPlanService';
import { formatMs } from '@shared/utils/time';
import type { PreviewMode, PreviewTarget } from '@renderer/stores/playbackStore';

interface PreviewPanelProps {
  project: ProjectFile;
  selectedTrack?: Track;
  checkedTrackIds: string[];
  proxyStatusByTrackId: Record<string, TrackProxyStatus>;
  playingTrackId: string | null;
  currentTimeMs: number;
  currentLabel: string;
  isPlaying: boolean;
  volume: number;
  target: PreviewTarget;
  mode: PreviewMode;
  onSelectTarget: (target: PreviewTarget) => void;
  onSelectMode: (mode: PreviewMode) => void;
  onChangeVolume: (volume: number) => void;
  onSeekPreview: (timeMs: number) => void;
  onPlaySingle: () => void;
  onPlayMedley: () => void;
  onStop: () => void;
  onSelectTrack: (trackId: string) => void;
  onToggleTrackCheck: (trackId: string) => void;
  onToggleAllQueueChecked: (checked: boolean) => void;
  onReorderTrack: (
    trackId: string,
    targetTrackId: string,
    placement: 'before' | 'after'
  ) => void;
  onGenerateTrackProxies: () => void;
  generatingTrackProxies: boolean;
  proxyGenerationButtonLabel: string;
  proxyGenerationButtonTitle: string;
  onRemoveCheckedFromQueue: () => void;
}

export function PreviewPanel({
  project,
  selectedTrack,
  checkedTrackIds,
  proxyStatusByTrackId,
  playingTrackId,
  currentTimeMs,
  currentLabel,
  isPlaying,
  volume,
  target,
  mode,
  onSelectTarget,
  onSelectMode,
  onChangeVolume,
  onSeekPreview,
  onPlaySingle,
  onPlayMedley,
  onStop,
  onSelectTrack,
  onToggleTrackCheck,
  onToggleAllQueueChecked,
  onReorderTrack,
  onGenerateTrackProxies,
  generatingTrackProxies,
  proxyGenerationButtonLabel,
  proxyGenerationButtonTitle,
  onRemoveCheckedFromQueue
}: PreviewPanelProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [auditionHeight, setAuditionHeight] = useState(168);
  const [resizing, setResizing] = useState(false);
  const [hasDraggedAudition, setHasDraggedAudition] = useState(false);
  const [draggedTrackId, setDraggedTrackId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ trackId: string; placement: 'before' | 'after' } | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);
  const queueTracks = project.tracks.filter((track) => track.exportEnabled);
  const queuePlans = buildProjectPreviewPlan(project);
  const selectedPlan = selectedTrack ? buildSingleTrackPreviewPlan(selectedTrack, project) : null;
  const singleDurationMs =
    selectedPlan && mode === 'original'
      ? selectedPlan.trimmedSourceDurationMs
      : selectedPlan?.processedDurationMs ?? 1;
  const medleyDurationMs =
    queuePlans.reduce((sum, plan) => sum + plan.processedDurationMs, 0) +
    Math.max(0, queueTracks.length - 1) * Math.max(0, project.exportPreset.gapMs);
  const queueCheckedCount = queueTracks.filter((track) => checkedTrackIds.includes(track.id)).length;
  const allQueueChecked = queueTracks.length > 0 && queueCheckedCount === queueTracks.length;
  const showAuditionSummary = hasDraggedAudition && auditionHeight >= 228;
  const canGenerateProxy =
    queueCheckedCount > 0 || Boolean(selectedTrack && selectedTrack.exportEnabled);
  const currentModeLabel =
    mode === 'original' ? '原曲对比' : mode === 'processed' ? '变速试听' : '节拍器叠加';
  const currentTargetLabel = target === 'single' ? '单曲' : '串烧';
  const currentTrackLabel = selectedTrack?.name ?? '未选择歌曲';
  const currentTrackDurationLabel = selectedTrack
    ? formatMs(selectedPlan?.processedDurationMs ?? selectedTrack.durationMs)
    : '--:--.--';
  const currentTrackTempoLabel = selectedTrack
    ? `${Math.round(selectedTrack.sourceBpm)} → ${Math.round(selectedPlan?.targetBpm ?? selectedTrack.targetBpm ?? project.globalTargetBpm)} BPM`
    : '拖动下方分隔条后，可在这里查看当前歌曲信息';
  const previewDurationMs = Math.max(1, target === 'single' ? singleDurationMs : medleyDurationMs);
  const previewPositionMs = Math.max(
    0,
    Math.min(previewDurationMs, isScrubbing ? scrubValue : currentTimeMs)
  );

  useEffect(() => {
    if (isScrubbing) {
      return;
    }
    setScrubValue(Math.max(0, Math.min(previewDurationMs, currentTimeMs)));
  }, [currentTimeMs, previewDurationMs, isScrubbing]);

  useEffect(() => {
    if (!resizing) {
      return;
    }
    const handleMove = (event: MouseEvent) => {
      const root = rootRef.current;
      if (!root) {
        return;
      }
      const rect = root.getBoundingClientRect();
      const minCanvas = 180;
      const splitter = 8;
      const minAudition = 132;
      const maxAudition = Math.max(
        minAudition,
        rect.height - minCanvas - splitter - 16
      );
      const next = Math.max(
        minAudition,
        Math.min(maxAudition, rect.bottom - event.clientY)
      );
      setAuditionHeight(next);
    };
    const handleUp = () => setResizing(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [resizing]);

  const handleQueueDragOver = (
    event: DragEvent<HTMLButtonElement>,
    trackId: string
  ) => {
    if (!draggedTrackId || draggedTrackId === trackId) {
      return;
    }
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDropTarget({ trackId, placement });
  };

  const handleQueueDrop = (event: DragEvent<HTMLButtonElement>, trackId: string) => {
    event.preventDefault();
    const sourceTrackId = draggedTrackId;
    const rect = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDraggedTrackId(null);
    setDropTarget(null);
    if (!sourceTrackId || sourceTrackId === trackId) {
      return;
    }
    onReorderTrack(sourceTrackId, trackId, placement);
  };

  const commitPreviewSeek = (value: number) => {
    const nextPositionMs = Math.max(0, Math.min(previewDurationMs, value));
    setScrubValue(nextPositionMs);
    setIsScrubbing(false);
    onSeekPreview(nextPositionMs);
  };

  const handlePreviewSeekChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = Number(event.target.value);
    setScrubValue(nextValue);
  };

  const handlePreviewSeekCommit = (event: SyntheticEvent<HTMLInputElement>) => {
    commitPreviewSeek(Number(event.currentTarget.value));
  };

  return (
    <section className="panel">
      <div
        ref={rootRef}
        className="preview-layout no-drag"
        style={{ gridTemplateRows: `minmax(180px, 1fr) 8px ${auditionHeight}px` }}
      >
        <div className="preview-canvas">
          <div className="preview-canvas-title">
            <div className="preview-canvas-title-left">
              <label className="library-check-all">
                <input
                  type="checkbox"
                  checked={allQueueChecked}
                  onChange={(event) => onToggleAllQueueChecked(event.target.checked)}
                />
                <span>全选</span>
              </label>
              <button
                className="wire-btn"
                disabled={!canGenerateProxy && !generatingTrackProxies}
                title={proxyGenerationButtonTitle}
                onClick={onGenerateTrackProxies}
              >
                {proxyGenerationButtonLabel}
              </button>
            </div>
            <strong className="section-title">工作区</strong>
            <div className="preview-canvas-tools">
              <span className="preview-canvas-count">共 {queueTracks.length} 首</span>
              <button
                className="wire-btn"
                disabled={queueCheckedCount === 0}
                onClick={onRemoveCheckedFromQueue}
              >
                移除列表
              </button>
            </div>
          </div>
          <div className="preview-canvas-list">
            {queueTracks.length === 0 ? (
              <div className="preview-canvas-empty">将左侧勾选歌曲加入这里，形成串烧/试听顺序</div>
            ) : (
              queueTracks.map((track, index) => {
                const active = playingTrackId === track.id;
                const selected = selectedTrack?.id === track.id;
                const checked = checkedTrackIds.includes(track.id);
                const plan = queuePlans.find((item) => item.trackId === track.id);
                const proxyStatus = proxyStatusByTrackId[track.id] ?? 'missing';
                const proxyStatusLabel =
                  proxyStatus === 'ready'
                    ? '代理已生成'
                    : proxyStatus === 'generating'
                      ? '代理生成中'
                    : proxyStatus === 'stale'
                      ? '代理已过期'
                      : '未生成代理';
                return (
                  <button
                    key={track.id}
                    className={`preview-canvas-item ${selected ? 'selected' : ''} ${active ? 'active' : ''} ${draggedTrackId === track.id ? 'dragging' : ''} ${dropTarget?.trackId === track.id ? `drop-${dropTarget.placement}` : ''}`}
                    onClick={() => onSelectTrack(track.id)}
                    draggable
                    onDragStart={(event) => {
                      setDraggedTrackId(track.id);
                      setDropTarget(null);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', track.id);
                    }}
                    onDragEnd={() => {
                      setDraggedTrackId(null);
                      setDropTarget(null);
                    }}
                    onDragOver={(event) => handleQueueDragOver(event, track.id)}
                    onDrop={(event) => handleQueueDrop(event, track.id)}
                  >
                    <div className="preview-canvas-item-main">
                      <div
                        className="preview-item-check"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleTrackCheck(track.id)}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </div>
                      <strong>
                        {String(index + 1).padStart(2, '0')} {track.name}
                      </strong>
                      <div className="muted">
                        {Math.round(track.sourceBpm)} → {Math.round(plan?.targetBpm ?? track.targetBpm ?? project.globalTargetBpm)} BPM
                      </div>
                    </div>
                    <div className="preview-canvas-item-side">
                      <span className={`proxy-status-chip ${proxyStatus}`}>
                        {proxyStatusLabel}
                      </span>
                      <div className="muted">{formatMs(plan?.processedDurationMs ?? track.durationMs)}</div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
        <div
          className={`preview-row-splitter ${resizing ? 'active' : ''}`}
          onMouseDown={() => {
            setHasDraggedAudition(true);
            setResizing(true);
          }}
        />

        <div className={`preview-audition-block ${showAuditionSummary ? 'expanded' : 'compact'}`}>
          <div className="preview-function-strip">
            <button
              className={`wire-btn ${target === 'single' ? 'primary' : ''}`}
              onClick={() => onSelectTarget('single')}
            >
              单曲试听
            </button>
            <button
              className={`wire-btn ${target === 'medley' ? 'primary' : ''}`}
              onClick={() => onSelectTarget('medley')}
            >
              串烧试听
            </button>
            <button
              className={`wire-btn ${mode === 'processed' ? 'primary' : ''}`}
              onClick={() => onSelectMode('processed')}
            >
              变速试听
            </button>
            <button
              className={`wire-btn ${mode === 'metronome' ? 'primary' : ''}`}
              onClick={() => onSelectMode('metronome')}
            >
              添加节拍器
            </button>
            <button
              className={`wire-btn ${mode === 'original' ? 'primary' : ''}`}
              disabled={target === 'medley'}
              onClick={() => onSelectMode('original')}
            >
              原曲对比
            </button>
          </div>

          <div className="preview-transport">
            <div className="preview-transport-row">
              <div className="preview-transport-buttons">
                <button
                  className="wire-btn primary"
                  disabled={target === 'single' ? !selectedTrack : queueTracks.length === 0}
                  onClick={target === 'single' ? onPlaySingle : onPlayMedley}
                >
                  播放
                </button>
                <button className="wire-btn" onClick={onStop}>
                  暂停/停止
                </button>
                <button className="wire-btn" disabled>
                  前进
                </button>
                <button className="wire-btn" disabled>
                  后退
                </button>
              </div>
              <label className="preview-volume-control">
                <span className="muted">音量</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(volume * 100)}
                  onChange={(event) => onChangeVolume(Number(event.target.value) / 100)}
                />
              </label>
            </div>
            <div className="preview-progress">
              <input
                className="preview-progress-slider"
                type="range"
                min={0}
                max={previewDurationMs}
                step={10}
                value={previewPositionMs}
                onMouseDown={() => setIsScrubbing(true)}
                onTouchStart={() => setIsScrubbing(true)}
                onChange={handlePreviewSeekChange}
                onMouseUp={handlePreviewSeekCommit}
                onTouchEnd={handlePreviewSeekCommit}
                onKeyUp={handlePreviewSeekCommit}
                onBlur={handlePreviewSeekCommit}
              />
              <span className="muted">
                {isPlaying ? currentLabel || '试听中' : '待命'} / {formatMs(previewPositionMs)}
              </span>
            </div>
          </div>
          {showAuditionSummary && (
            <div className="preview-summary">
              <div className="preview-summary-card">
                <div className="preview-summary-main">
                  <span className="preview-summary-kicker">当前选择</span>
                  <strong className="preview-summary-title" title={currentTrackLabel}>
                    {currentTrackLabel}
                  </strong>
                  <span className="preview-summary-subtitle">{currentTrackTempoLabel}</span>
                </div>
                <div className="preview-summary-stats">
                  <span className="preview-summary-chip">{currentModeLabel}</span>
                  <span className="preview-summary-chip">{currentTargetLabel}</span>
                  <span className="preview-summary-chip">{currentTrackDurationLabel}</span>
                  <span className="preview-summary-chip">{queueTracks.length} 首编排</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
