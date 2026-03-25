import { useEffect, useRef, useState } from 'react';
import type { ProjectFile, Track } from '@shared/types';
import { buildProjectPreviewPlan, buildSingleTrackPreviewPlan } from '@shared/services/previewPlanService';
import { formatMs } from '@shared/utils/time';
import type { PreviewMode, PreviewTarget } from '@renderer/stores/playbackStore';

interface PreviewPanelProps {
  project: ProjectFile;
  selectedTrack?: Track;
  checkedTrackIds: string[];
  playingTrackId: string | null;
  currentTimeMs: number;
  currentLabel: string;
  isPlaying: boolean;
  target: PreviewTarget;
  mode: PreviewMode;
  onSelectTarget: (target: PreviewTarget) => void;
  onSelectMode: (mode: PreviewMode) => void;
  onPlaySingle: () => void;
  onPlayMedley: () => void;
  onStop: () => void;
  onSelectTrack: (trackId: string) => void;
  onToggleTrackCheck: (trackId: string) => void;
  onToggleAllQueueChecked: (checked: boolean) => void;
  onMoveSelectedTrack: (direction: 'up' | 'down') => void;
  onRemoveCheckedFromQueue: () => void;
}

export function PreviewPanel({
  project,
  selectedTrack,
  checkedTrackIds,
  playingTrackId,
  currentTimeMs,
  currentLabel,
  isPlaying,
  target,
  mode,
  onSelectTarget,
  onSelectMode,
  onPlaySingle,
  onPlayMedley,
  onStop,
  onSelectTrack,
  onToggleTrackCheck,
  onToggleAllQueueChecked,
  onMoveSelectedTrack,
  onRemoveCheckedFromQueue
}: PreviewPanelProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [auditionHeight, setAuditionHeight] = useState(220);
  const [resizing, setResizing] = useState(false);
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
      const minAudition = 180;
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

  return (
    <section className="panel">
      <div
        ref={rootRef}
        className="preview-layout no-drag"
        style={{ gridTemplateRows: `minmax(180px, 1fr) 8px ${auditionHeight}px` }}
      >
        <div className="preview-canvas">
          <div className="preview-canvas-title">
            <label className="library-check-all">
              <input
                type="checkbox"
                checked={allQueueChecked}
                onChange={(event) => onToggleAllQueueChecked(event.target.checked)}
              />
              <span>全选</span>
            </label>
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
                return (
                  <button
                    key={track.id}
                    className={`preview-canvas-item ${selected ? 'selected' : ''} ${active ? 'active' : ''}`}
                    onClick={() => onSelectTrack(track.id)}
                  >
                    <div className="preview-canvas-item-main">
                      <label className="preview-item-check">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleTrackCheck(track.id)}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </label>
                      <strong>
                        {String(index + 1).padStart(2, '0')} {track.name}
                      </strong>
                      <div className="muted">
                        {Math.round(track.sourceBpm)} → {Math.round(track.targetBpm ?? track.sourceBpm)} BPM
                      </div>
                    </div>
                    <div className="muted">{formatMs(plan?.processedDurationMs ?? track.durationMs)}</div>
                  </button>
                );
              })
            )}
          </div>
        </div>
        <div
          className={`preview-row-splitter ${resizing ? 'active' : ''}`}
          onMouseDown={() => setResizing(true)}
        />

        <div className="preview-audition-block">
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
            <button className="wire-btn" disabled={!selectedTrack} onClick={() => onMoveSelectedTrack('up')}>
              上移
            </button>
            <button className="wire-btn" disabled={!selectedTrack} onClick={() => onMoveSelectedTrack('down')}>
              下移
            </button>
          </div>

          <div className="preview-transport">
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
            <div className="preview-progress">
              <progress
                value={isPlaying ? Math.max(1, currentTimeMs) : 0}
                max={Math.max(1, target === 'single' ? singleDurationMs : medleyDurationMs)}
              />
              <span className="muted">
                {isPlaying ? currentLabel || '试听中' : '待命'} / {formatMs(currentTimeMs)}
              </span>
            </div>
          </div>

          <div className="preview-monitor">
            <div className="preview-monitor-box">
              <strong>试听工作区</strong>
              <div className="preview-monitor-meta">
                <span>目标: {target === 'single' ? '单曲' : '串烧'}</span>
                <span>
                  模式:
                  {mode === 'original' ? ' 原曲' : mode === 'processed' ? ' 变速后' : ' 节拍器叠加'}
                </span>
              </div>
              <div className="preview-monitor-meta">
                <span>当前选择: {selectedTrack?.name ?? '未选择歌曲'}</span>
                <span>编排数量: {queueTracks.length}</span>
              </div>
              <p className="muted" style={{ margin: 0 }}>
                这里负责试听单曲或串烧在变速与添加节拍后的效果。当前实现以真实音频播放为主，串烧按编排顺序连续试听。
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
