import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent
} from 'react';
import {
  AlarmClock,
  AudioWaveform,
  CircleStop,
  Disc3,
  Gauge,
  LayoutList,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX
} from 'lucide-react';
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
  onPause: () => void;
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
  onPause,
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
  const previewSeekRef = useRef<HTMLInputElement | null>(null);
  const scrubbingRef = useRef(false);
  const scrubValueRef = useRef(0);
  const [auditionHeight, setAuditionHeight] = useState(220);
  const [resizing, setResizing] = useState(false);
  const [draggedTrackId, setDraggedTrackId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ trackId: string; placement: 'before' | 'after' } | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);
  const getProxyStatusLabel = (proxyStatus: TrackProxyStatus) =>
    proxyStatus === 'ready'
      ? '代理已生成'
      : proxyStatus === 'generating'
        ? '代理生成中'
        : proxyStatus === 'stale'
          ? '代理已过期'
          : '未生成代理';
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
  const canGenerateProxy =
    queueCheckedCount > 0 || Boolean(selectedTrack && selectedTrack.exportEnabled);
  const currentModeLabel =
    mode === 'original' ? '原曲对比' : mode === 'processed' ? '变速试听' : '节拍器叠加';
  const currentTargetLabel = target === 'single' ? '单曲' : '串烧';
  const canControlPreview = target === 'single' ? Boolean(selectedTrack) : queueTracks.length > 0;
  const previewDurationMs = Math.max(1, target === 'single' ? singleDurationMs : medleyDurationMs);
  const previewPositionMs = Math.max(
    0,
    Math.min(previewDurationMs, isScrubbing ? scrubValue : currentTimeMs)
  );
  const previewProgressPercent = `${Math.max(
    0,
    Math.min(100, (previewPositionMs / Math.max(1, previewDurationMs)) * 100)
  )}%`;
  const volumePercent = `${Math.round(volume * 100)}%`;
  const previewStatusLabel = isPlaying
    ? currentLabel || '试听中'
    : previewPositionMs > 0
      ? '已暂停'
      : '待命';
  const previewStatusTone =
    isPlaying ? 'playing' : previewPositionMs > 0 ? 'paused' : 'idle';
  const PreviewVolumeIcon = volume === 0 ? VolumeX : volume < 0.45 ? Volume1 : Volume2;
  const selectedTrackProxyStatus = selectedTrack
    ? (proxyStatusByTrackId[selectedTrack.id] ?? 'missing')
    : null;
  const selectedTargetBpm = Math.round(
    selectedPlan?.targetBpm ?? selectedTrack?.targetBpm ?? project.globalTargetBpm
  );
  const summaryTitle = !selectedTrack
    ? target === 'medley' && queueTracks.length > 0
      ? '先检查工作区顺序，再听串接是否自然'
      : '先从工作区选择一首歌'
    : mode === 'metronome'
      ? '重点检查首拍与节拍器偏移'
      : mode === 'original'
        ? '先用原曲确认节奏基准'
        : '先确认变速听感，再进入导出';
  const summarySubtitle = !selectedTrack
    ? target === 'medley' && queueTracks.length > 0
      ? `当前串烧按 ${Math.round(project.globalTargetBpm)} BPM 组织，确认顺序后再回右侧微调每首歌的首拍与节拍器偏移。`
      : '这里最适合快速核对 BPM、首拍偏移和节拍器偏移，再决定是否导出。'
    : mode === 'metronome'
      ? `当前歌曲会从 ${Math.round(selectedTrack.sourceBpm)} BPM 对齐到 ${selectedTargetBpm} BPM。click 没贴住音乐时，优先微调右侧两个偏移。`
      : mode === 'original'
        ? '先确认切点和节奏基准，再切回变速或节拍器模式复查对齐。'
        : selectedTrackProxyStatus === 'ready'
          ? `当前歌曲会从 ${Math.round(selectedTrack.sourceBpm)} BPM 对齐到 ${selectedTargetBpm} BPM，听感稳定后可继续做串烧或导出前检查。`
          : `当前歌曲会从 ${Math.round(selectedTrack.sourceBpm)} BPM 对齐到 ${selectedTargetBpm} BPM，确认无误后可先生成代理，后续串烧试听更稳定。`;
  const summaryChips = selectedTrack
    ? [
        currentTargetLabel,
        `目标 ${selectedTargetBpm} BPM`,
        `首拍 ${selectedTrack.downbeatOffsetMs} ms`,
        `节拍器 ${selectedTrack.metronomeOffsetMs} ms`
      ]
    : [
        currentTargetLabel,
        currentModeLabel,
        queueTracks.length > 0 ? `${queueTracks.length} 首工作区` : '工作区为空',
        `全局 ${Math.round(project.globalTargetBpm)} BPM`
      ];
  const targetControls = [
    {
      key: 'single',
      label: '单曲试听',
      icon: Disc3,
      active: target === 'single',
      disabled: false,
      onClick: () => onSelectTarget('single')
    },
    {
      key: 'medley',
      label: '串烧试听',
      icon: LayoutList,
      active: target === 'medley',
      disabled: false,
      onClick: () => onSelectTarget('medley')
    }
  ];
  const modeControls = [
    {
      key: 'processed',
      label: '变速试听',
      icon: Gauge,
      active: mode === 'processed',
      disabled: false,
      onClick: () => onSelectMode('processed')
    },
    {
      key: 'metronome',
      label: '添加节拍器',
      icon: AlarmClock,
      active: mode === 'metronome',
      disabled: false,
      onClick: () => onSelectMode('metronome')
    },
    {
      key: 'original',
      label: '原曲对比',
      icon: AudioWaveform,
      active: mode === 'original',
      disabled: target === 'medley',
      onClick: () => onSelectMode('original')
    }
  ];

  useEffect(() => {
    if (isScrubbing) {
      return;
    }
    const nextValue = Math.max(0, Math.min(previewDurationMs, currentTimeMs));
    scrubValueRef.current = nextValue;
    setScrubValue(nextValue);
  }, [currentTimeMs, previewDurationMs, isScrubbing]);

  const commitPreviewSeek = useEffectEvent((value: number) => {
    const nextPositionMs = Math.max(0, Math.min(previewDurationMs, value));
    scrubbingRef.current = false;
    scrubValueRef.current = nextPositionMs;
    setScrubValue(nextPositionMs);
    setIsScrubbing(false);
    onSeekPreview(nextPositionMs);
  });

  useEffect(() => {
    if (!isScrubbing) {
      return;
    }

    const commitOnRelease = () => {
      const nextValue = Number(previewSeekRef.current?.value ?? scrubValueRef.current);
      commitPreviewSeek(nextValue);
    };

    window.addEventListener('pointerup', commitOnRelease);
    window.addEventListener('pointercancel', commitOnRelease);
    return () => {
      window.removeEventListener('pointerup', commitOnRelease);
      window.removeEventListener('pointercancel', commitOnRelease);
    };
  }, [isScrubbing, commitPreviewSeek]);

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

  const startPreviewSeek = () => {
    scrubbingRef.current = true;
    setIsScrubbing(true);
  };

  const handlePreviewSeekChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = Number(event.target.value);
    scrubValueRef.current = nextValue;
    setScrubValue(nextValue);
    if (!scrubbingRef.current) {
      commitPreviewSeek(nextValue);
    }
  };

  const handlePreviewStep = (deltaMs: number) => {
    if (!canControlPreview) {
      return;
    }
    onSeekPreview(
      Math.max(0, Math.min(previewDurationMs, Math.round(previewPositionMs + deltaMs)))
    );
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
                const proxyStatusLabel = getProxyStatusLabel(proxyStatus);
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
            setResizing(true);
          }}
        />

        <div className="preview-audition-block">
          <div className="preview-function-strip">
            <div className="preview-icon-strip">
              <div className="preview-icon-cluster" role="group" aria-label="试听目标">
                {targetControls.map((control) => {
                  const Icon = control.icon;
                  return (
                    <button
                      key={control.key}
                      type="button"
                      className={`preview-toggle-btn ${control.active ? 'active' : ''}`}
                      aria-label={control.label}
                      aria-pressed={control.active}
                      title={control.label}
                      disabled={control.disabled}
                      onClick={control.onClick}
                    >
                      <Icon size={20} strokeWidth={2.2} />
                    </button>
                  );
                })}
              </div>
              <span className="preview-icon-divider" aria-hidden="true" />
              <div className="preview-icon-cluster" role="group" aria-label="试听模式">
                {modeControls.map((control) => {
                  const Icon = control.icon;
                  return (
                    <button
                      key={control.key}
                      type="button"
                      className={`preview-toggle-btn ${control.active ? 'active' : ''}`}
                      aria-label={control.label}
                      aria-pressed={control.active}
                      title={control.label}
                      disabled={control.disabled}
                      onClick={control.onClick}
                    >
                      <Icon size={20} strokeWidth={2.2} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="preview-transport">
            <div className="preview-deck">
              <div className="preview-play-cluster compact" role="group" aria-label="播放控制">
                <button
                  type="button"
                  className="transport-button transport-utility"
                  aria-label="后退 10 秒"
                  title="后退 10 秒"
                  disabled={!canControlPreview}
                  onClick={() => handlePreviewStep(-10000)}
                >
                  <SkipBack size={18} strokeWidth={2.2} />
                </button>
                <button
                  type="button"
                  className={`transport-button transport-core ${isPlaying ? 'active' : ''}`}
                  aria-label="播放"
                  title="播放"
                  disabled={!canControlPreview || isPlaying}
                  onClick={target === 'single' ? onPlaySingle : onPlayMedley}
                >
                  <Play size={20} strokeWidth={2.35} />
                </button>
                <button
                  type="button"
                  className="transport-button transport-utility"
                  aria-label="暂停"
                  title="暂停"
                  disabled={!isPlaying}
                  onClick={onPause}
                >
                  <Pause size={16} strokeWidth={2.35} />
                </button>
                <button
                  type="button"
                  className="transport-button transport-utility stop"
                  aria-label="停止"
                  title="停止"
                  disabled={!canControlPreview || (!isPlaying && previewPositionMs <= 0)}
                  onClick={onStop}
                >
                  <CircleStop size={16} strokeWidth={2.2} />
                </button>
                <button
                  type="button"
                  className="transport-button transport-utility"
                  aria-label="前进 10 秒"
                  title="前进 10 秒"
                  disabled={!canControlPreview}
                  onClick={() => handlePreviewStep(10000)}
                >
                  <SkipForward size={18} strokeWidth={2.2} />
                </button>
              </div>
              <label className="preview-volume-dock compact">
                <span className="preview-volume-icon" aria-hidden="true">
                  <PreviewVolumeIcon size={16} strokeWidth={2.2} />
                </span>
                <input
                  className="preview-volume-slider"
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(volume * 100)}
                  aria-label="音量"
                  style={{ '--volume-percent': volumePercent } as CSSProperties}
                  onChange={(event) => onChangeVolume(Number(event.target.value) / 100)}
                />
              </label>
            </div>
            <div className="preview-progress-stack">
              <div className="preview-progress-row">
                <div className="preview-progress-shell">
                  <input
                    ref={previewSeekRef}
                    className="preview-progress-slider"
                    type="range"
                    min={0}
                    max={previewDurationMs}
                    step={10}
                    value={previewPositionMs}
                    aria-label="试听进度"
                    style={{ '--progress-percent': previewProgressPercent } as CSSProperties}
                    onPointerDown={startPreviewSeek}
                    onChange={handlePreviewSeekChange}
                  />
                </div>
                <span className="preview-progress-time">
                  {formatMs(previewPositionMs)} / {formatMs(previewDurationMs)}
                </span>
              </div>
              <div className="preview-progress-status-row">
                <span className={`preview-progress-status ${previewStatusTone}`}>
                  <span className="preview-progress-status-dot" aria-hidden="true" />
                  <span className="preview-progress-status-label">{previewStatusLabel}</span>
                </span>
              </div>
            </div>
          </div>
          <div className="preview-summary">
            <div className="preview-summary-card">
              <div className="preview-summary-main">
                <span className="preview-summary-kicker">试听建议</span>
                <strong className="preview-summary-title" title={summaryTitle}>
                  {summaryTitle}
                </strong>
                <span className="preview-summary-subtitle">{summarySubtitle}</span>
              </div>
              <div className="preview-summary-stats">
                {summaryChips.map((chip) => (
                  <span key={chip} className="preview-summary-chip">
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
