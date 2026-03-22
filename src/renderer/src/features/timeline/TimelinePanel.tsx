import { useEffect, useMemo, useRef, useState, type WheelEventHandler } from 'react';
import type { ProjectFile, Track, TrackRenderPlan } from '@shared/types';
import { buildSingleTrackPreviewPlan } from '@shared/services/previewPlanService';
import { formatMs } from '@shared/utils/time';
import { useI18n } from '@renderer/features/i18n/I18nProvider';

interface TimelinePanelProps {
  project: ProjectFile;
  tracks: Track[];
  selectedTrackId?: string;
  currentTimeMs: number;
  onTrackStartChange: (trackId: string, startMs: number) => void;
  onSelectTrack: (trackId: string) => void;
  onPreviewOriginal: () => void;
  onPreviewProcessed: () => void;
  onPreviewMetronome: () => void;
  onPreviewPlay: () => void;
  onStop: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRemoveFromTimeline: () => void;
}

function getTimelineDuration(tracks: TrackRenderPlan[]): number {
  let max = 0;
  for (const track of tracks) {
    max = Math.max(max, track.trackStartMs + track.processedDurationMs);
  }
  return Math.max(120000, max + 5000);
}

function pickRulerStepSec(pxPerSec: number): number {
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const minLabelPx = 72;
  for (const step of steps) {
    if (step * pxPerSec >= minLabelPx) {
      return step;
    }
  }
  return 900;
}

function formatRulerLabel(sec: number): string {
  const minutes = Math.floor(sec / 60);
  const seconds = sec - minutes * 60;
  if (Math.abs(seconds - Math.round(seconds)) < 1e-6) {
    return `${minutes}:${String(Math.round(seconds)).padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

export function TimelinePanel({
  project,
  tracks,
  selectedTrackId,
  currentTimeMs,
  onTrackStartChange,
  onSelectTrack,
  onPreviewOriginal,
  onPreviewProcessed,
  onPreviewMetronome,
  onPreviewPlay,
  onStop,
  onUndo,
  onRedo,
  onRemoveFromTimeline
}: TimelinePanelProps) {
  const { t, language } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const previousTimelineTrackCountRef = useRef(0);
  const [containerWidth, setContainerWidth] = useState(900);
  const [userZoom, setUserZoom] = useState(0);
  const [showBeatGrid, setShowBeatGrid] = useState(true);
  const [snapToBeat, setSnapToBeat] = useState(true);
  const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null);
  const [dragPreviewStartMs, setDragPreviewStartMs] = useState<Record<string, number>>({});
  const [panMetrics, setPanMetrics] = useState({
    scrollLeft: 0,
    clientWidth: 1,
    scrollWidth: 1
  });
  const dragStateRef = useRef<{
    trackId: string;
    startClientX: number;
    originStartMs: number;
  } | null>(null);
  const panTrackRef = useRef<HTMLDivElement | null>(null);
  const panDragRef = useRef<{
    startClientX: number;
    startScrollLeft: number;
    maxScroll: number;
    maxThumbLeft: number;
  } | null>(null);

  const trackPlans = useMemo(
    () =>
      tracks
        .filter((track) => track.inTimeline)
        .sort((a, b) => a.trackStartMs - b.trackStartMs)
        .map((track) => buildSingleTrackPreviewPlan(track, project)),
    [project, tracks]
  );

  const durationMs = getTimelineDuration(trackPlans);
  const durationSec = durationMs / 1000;
  const minZoom = 0.05;
  const maxZoom = Math.max(1, containerWidth / 10);
  const fitZoom = Math.max(minZoom, containerWidth / Math.max(10, durationSec));
  const pxPerSec = userZoom || fitZoom;
  const timelineWidth = Math.max(containerWidth, durationSec * pxPerSec);
  const beatMs = Math.max(1, 60000 / Math.max(1, project.globalTargetBpm));
  const selectedPlan = trackPlans.find((plan) => plan.trackId === selectedTrackId);
  const beatLines = selectedPlan?.beatTimesMs ?? [];
  const totalDurationSec = durationSec;
  const rulerStepSec = pickRulerStepSec(pxPerSec);
  const rulerMarks = Array.from({
    length: Math.ceil(totalDurationSec / rulerStepSec) + 1
  }).map((_, index) => index * rulerStepSec);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    const resize = () => setContainerWidth(node.clientWidth);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const previous = previousTimelineTrackCountRef.current;
    const current = trackPlans.length;
    if (current > previous) {
      setUserZoom(0);
    }
    previousTimelineTrackCountRef.current = current;
  }, [trackPlans.length]);

  useEffect(() => {
    const node = timelineScrollRef.current;
    if (!node) {
      return;
    }
    const handleNativeWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();
      const current = userZoom || fitZoom;
      const scaled = event.deltaY < 0 ? current * 1.12 : current / 1.12;
      const next = Math.max(minZoom, Math.min(maxZoom, scaled));
      const closeToFit = Math.abs(next - fitZoom) <= Math.max(0.2, fitZoom * 0.02);
      setUserZoom(closeToFit ? 0 : next);
    };
    node.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => {
      node.removeEventListener('wheel', handleNativeWheel);
    };
  }, [fitZoom, maxZoom, minZoom, userZoom]);

  useEffect(() => {
    const node = timelineScrollRef.current;
    if (!node) {
      return;
    }
    const syncPan = () => {
      setPanMetrics({
        scrollLeft: node.scrollLeft,
        clientWidth: Math.max(1, node.clientWidth),
        scrollWidth: Math.max(1, node.scrollWidth)
      });
    };
    syncPan();
    node.addEventListener('scroll', syncPan);
    const observer = new ResizeObserver(syncPan);
    observer.observe(node);
    return () => {
      node.removeEventListener('scroll', syncPan);
      observer.disconnect();
    };
  }, [timelineWidth]);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const drag = panDragRef.current;
      const node = timelineScrollRef.current;
      if (!drag || !node) {
        return;
      }
      const deltaX = event.clientX - drag.startClientX;
      const ratio = drag.maxThumbLeft > 0 ? drag.maxScroll / drag.maxThumbLeft : 0;
      node.scrollLeft = Math.max(0, Math.min(drag.maxScroll, drag.startScrollLeft + deltaX * ratio));
    };
    const handleUp = () => {
      panDragRef.current = null;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }
      const deltaMs = ((event.clientX - dragState.startClientX) / pxPerSec) * 1000;
      const rawNext = Math.max(0, Math.round(dragState.originStartMs + deltaMs));
      const next = snapToBeat ? Math.round(rawNext / beatMs) * beatMs : rawNext;
      setDragPreviewStartMs((prev) => ({
        ...prev,
        [dragState.trackId]: next
      }));
    };

    const handleUp = () => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }
      const next = dragPreviewStartMs[dragState.trackId] ?? dragState.originStartMs;
      if (next !== dragState.originStartMs) {
        onTrackStartChange(dragState.trackId, next);
      }
      dragStateRef.current = null;
      setDraggingTrackId(null);
      setDragPreviewStartMs((prev) => {
        const copy = { ...prev };
        delete copy[dragState.trackId];
        return copy;
      });
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [beatMs, dragPreviewStartMs, onTrackStartChange, pxPerSec, snapToBeat]);

  const handleTimelineWheel: WheelEventHandler<HTMLDivElement> = (event) => {
    const node = timelineScrollRef.current;
    if (!node) {
      return;
    }
    if (event.ctrlKey) {
      event.preventDefault();
      const current = userZoom || fitZoom;
      const scaled = event.deltaY < 0 ? current * 1.12 : current / 1.12;
      const next = Math.max(minZoom, Math.min(maxZoom, scaled));
      const closeToFit = Math.abs(next - fitZoom) <= Math.max(0.2, fitZoom * 0.02);
      setUserZoom(closeToFit ? 0 : next);
      return;
    }
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.preventDefault();
      node.scrollLeft += event.deltaY;
    }
  };

  const maxScroll = Math.max(0, panMetrics.scrollWidth - panMetrics.clientWidth);
  const viewportRatio = Math.min(1, panMetrics.clientWidth / panMetrics.scrollWidth);
  const panTrackWidth = panTrackRef.current?.clientWidth ?? panMetrics.clientWidth;
  const thumbWidth = Math.max(28, panTrackWidth * viewportRatio);
  const maxThumbLeft = Math.max(0, panTrackWidth - thumbWidth);
  const thumbLeft = maxScroll > 0 ? (panMetrics.scrollLeft / maxScroll) * maxThumbLeft : 0;

  return (
    <section className="panel" style={{ borderRight: '1px solid var(--line)' }}>
      <div className="timeline-shell no-drag" ref={containerRef}>
        <div className="panel-header">
          <strong>{t('timeline.title')}</strong>
          <div className="timeline-top-actions">
            <span className="muted">{t('timeline.zoom')}</span>
            <input
              type="range"
              min={minZoom}
              max={maxZoom}
              step={0.1}
              value={userZoom || fitZoom}
              onChange={(event) => setUserZoom(Number(event.target.value))}
            />
            <button onClick={() => setUserZoom(0)}>适配全部</button>
            <button className="pill" onClick={onStop}>{t('common.cancel')}</button>
            <button className="pill" onClick={onUndo}>{t('common.undo')}</button>
            <button className="pill" onClick={onRedo}>{t('common.redo')}</button>
          </div>
        </div>
        <div className="music-stage">
          {trackPlans.length === 0 ? (
            <div className="music-empty">从左侧勾选歌曲并加入时间线</div>
          ) : (
            trackPlans.map((plan) => (
              <button
                key={plan.trackId}
                className={`music-card ${selectedTrackId === plan.trackId ? 'active' : ''}`}
                onClick={() => onSelectTrack(plan.trackId)}
              >
                <strong>{plan.trackName}</strong>
                <span className="muted">
                  {Math.round(plan.sourceBpm)} → {Math.round(plan.targetBpm)} BPM
                </span>
              </button>
            ))
          )}
        </div>
        <div className="timeline-function-bar">
          <button className="pill" onClick={onPreviewOriginal}>{t('toolbar.previewOriginal')}</button>
          <button className="pill" onClick={onPreviewProcessed}>{t('toolbar.previewProcessed')}</button>
          <button className="pill" onClick={onPreviewMetronome}>{t('toolbar.previewMetronome')}</button>
          <button className="pill primary" onClick={onPreviewPlay}>{t('common.preview')}</button>
          <button className="pill" onClick={() => setSnapToBeat((value) => !value)}>
            {snapToBeat ? '吸附已开' : '吸附已关'}
          </button>
          <button className="pill" onClick={() => setShowBeatGrid((value) => !value)}>
            {showBeatGrid ? '隐藏节拍网格' : '显示节拍网格'}
          </button>
          <button className="pill" disabled={!selectedTrackId} onClick={onRemoveFromTimeline}>
            移出时间线
          </button>
        </div>
        <div className="timeline-modern">
          <div className="timeline-ruler" style={{ width: timelineWidth }}>
            {rulerMarks.map((sec) => {
              return (
                <div key={sec} className="ruler-mark" style={{ left: sec * pxPerSec }}>
                  {formatRulerLabel(sec)}
                </div>
              );
            })}
          </div>
          <div
            ref={timelineScrollRef}
            className="timeline-scroll modern"
            onWheel={handleTimelineWheel}
          >
            <div style={{ width: timelineWidth, minHeight: 130 }}>
              <div className="timeline-lane-label">Track 1</div>
              {showBeatGrid &&
                beatLines.map((ms, index) => {
                  const left = (ms / 1000) * pxPerSec;
                  const isBar = index % 4 === 0;
                  return (
                    <div
                      key={`${ms}-${index}`}
                      className={`timeline-grid-line ${isBar ? 'bar' : ''}`}
                      style={{ left }}
                    />
                  );
                })}
              {trackPlans.map((plan) => {
                const previewStartMs = dragPreviewStartMs[plan.trackId];
                const startMs = previewStartMs ?? plan.trackStartMs;
                const left = (startMs / 1000) * pxPerSec;
                const width = Math.max(90, (plan.processedDurationMs / 1000) * pxPerSec);
                return (
                  <button
                    key={plan.trackId}
                    className={`timeline-clip modern ${selectedTrackId === plan.trackId ? 'active' : ''} ${draggingTrackId === plan.trackId ? 'dragging' : ''}`}
                    style={{ top: 36, left, width }}
                    onClick={() => onSelectTrack(plan.trackId)}
                    onMouseDown={(event) => {
                      if (event.button !== 0) {
                        return;
                      }
                      onSelectTrack(plan.trackId);
                      dragStateRef.current = {
                        trackId: plan.trackId,
                        startClientX: event.clientX,
                        originStartMs: plan.trackStartMs
                      };
                      setDraggingTrackId(plan.trackId);
                    }}
                  >
                    {plan.trackName}
                  </button>
                );
              })}
              <div
                className="timeline-playhead"
                style={{ left: `${(currentTimeMs / 1000) * pxPerSec}px` }}
              />
            </div>
          </div>
        </div>
        <div className="timeline-pan-bar">
          <div
            ref={panTrackRef}
            className="timeline-pan-track"
            onMouseDown={(event) => {
              const node = timelineScrollRef.current;
              const rect = panTrackRef.current?.getBoundingClientRect();
              if (!node || !rect || maxScroll <= 0) {
                return;
              }
              const clickX = event.clientX - rect.left;
              const targetLeft = Math.max(0, Math.min(maxThumbLeft, clickX - thumbWidth / 2));
              node.scrollLeft = (targetLeft / Math.max(1, maxThumbLeft)) * maxScroll;
            }}
          >
            <div
              className="timeline-pan-thumb"
              style={{ width: `${thumbWidth}px`, transform: `translateX(${thumbLeft}px)` }}
              onMouseDown={(event) => {
                event.stopPropagation();
                panDragRef.current = {
                  startClientX: event.clientX,
                  startScrollLeft: panMetrics.scrollLeft,
                  maxScroll,
                  maxThumbLeft
                };
              }}
            />
          </div>
        </div>
        <div className="footer-controls">
          <span className="muted">
            {t('timeline.beatGrid')} / {t('timeline.downbeatAnchor')}
          </span>
          <span>{formatMs(currentTimeMs, language)}</span>
        </div>
      </div>
    </section>
  );
}
