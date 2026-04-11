import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
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
import { generateBeatTimes } from '@shared/services/beatGridService';
import type { AudioWaveformData, ProjectFile, Track, TrackProxyStatus } from '@shared/types';
import { buildProjectPreviewPlan, buildSingleTrackPreviewPlan } from '@shared/services/previewPlanService';
import { getWorkspaceTracks } from '@shared/services/workspaceOrderService';
import { formatMs } from '@shared/utils/time';
import {
  PREVIEW_SPECIAL_LABEL_GAP,
  PREVIEW_SPECIAL_LABEL_MEDLEY,
  type PreviewMode,
  type PreviewTarget
} from '@renderer/stores/playbackStore';
import { useI18n } from '@renderer/features/i18n/I18nProvider';

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

const WAVEFORM_POINT_COUNT = 1200;
const WAVEFORM_VIEWBOX_WIDTH = 1000;
const WAVEFORM_VIEWBOX_HEIGHT = 220;
const WAVEFORM_CENTER_Y = WAVEFORM_VIEWBOX_HEIGHT / 2;
const MIN_WAVEFORM_ZOOM = 1;
const MAX_WAVEFORM_ZOOM = 12;
const RULER_STOPS = [0, 0.25, 0.5, 0.75, 1];

function clampToRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildWaveformAreaPath(peaks: number[]): string {
  if (peaks.length === 0) {
    return '';
  }

  const denominator = Math.max(1, peaks.length - 1);
  const topPoints = peaks.map((peak, index) => {
    const x = (index / denominator) * WAVEFORM_VIEWBOX_WIDTH;
    const y = WAVEFORM_CENTER_Y - peak * (WAVEFORM_VIEWBOX_HEIGHT * 0.44);
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  const bottomPoints = peaks
    .map((_, index) => {
      const reversedIndex = peaks.length - 1 - index;
      const x = (reversedIndex / denominator) * WAVEFORM_VIEWBOX_WIDTH;
      const y = WAVEFORM_CENTER_Y + peaks[reversedIndex]! * (WAVEFORM_VIEWBOX_HEIGHT * 0.44);
      return `L ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
  return `${topPoints.join(' ')} ${bottomPoints} Z`;
}

function buildWaveformStrokePath(peaks: number[]): string {
  if (peaks.length === 0) {
    return '';
  }

  const denominator = Math.max(1, peaks.length - 1);
  return peaks
    .map((peak, index) => {
      const x = (index / denominator) * WAVEFORM_VIEWBOX_WIDTH;
      const y = WAVEFORM_CENTER_Y - peak * (WAVEFORM_VIEWBOX_HEIGHT * 0.44);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function toPercent(positionMs: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }
  return clampToRange((positionMs / durationMs) * 100, 0, 100);
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
  const { t } = useI18n();
  const EDGE_AUTO_SCROLL_THRESHOLD_PX = 44;
  const EDGE_AUTO_SCROLL_HOLD_MS = 220;
  const EDGE_AUTO_SCROLL_MIN_STEP_PX = 4;
  const EDGE_AUTO_SCROLL_MAX_STEP_PX = 22;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const queueListRef = useRef<HTMLDivElement | null>(null);
  const previewSeekRef = useRef<HTMLInputElement | null>(null);
  const waveformScrollRef = useRef<HTMLDivElement | null>(null);
  const waveformCacheRef = useRef(new Map<string, AudioWaveformData>());
  const scrubbingRef = useRef(false);
  const scrubValueRef = useRef(0);
  const suppressDirectSeekUntilRef = useRef(0);
  const dragPointerRef = useRef<{ x: number; y: number } | null>(null);
  const queueTrackIdsRef = useRef<string[]>([]);
  const draggingTrackIdRef = useRef<string | null>(null);
  const pointerDragStateRef = useRef<{
    trackId: string;
    pointerId: number;
    startX: number;
    startY: number;
    started: boolean;
  } | null>(null);
  const reorderWorkTrackRef = useRef(onReorderTrack);
  const dropTargetRef = useRef<{ trackId: string; placement: 'before' | 'after' } | null>(null);
  const edgeScrollDirectionRef = useRef<-1 | 0 | 1>(0);
  const edgeScrollEnteredAtRef = useRef(0);
  const edgeAutoScrollFrameRef = useRef<number | null>(null);
  const [auditionHeight, setAuditionHeight] = useState(220);
  const [resizing, setResizing] = useState(false);
  const [draggedTrackId, setDraggedTrackId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ trackId: string; placement: 'before' | 'after' } | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);
  const [auditionView, setAuditionView] = useState<'controls' | 'visualizer'>('controls');
  const [waveformZoom, setWaveformZoom] = useState(1);
  const [waveformState, setWaveformState] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: AudioWaveformData | null;
    error: string;
  }>({
    status: 'idle',
    data: null,
    error: ''
  });
  type SeekCommitSource = 'window-release' | 'range-release' | 'change-direct';
  const getProxyStatusLabel = (proxyStatus: TrackProxyStatus) =>
    proxyStatus === 'ready'
      ? t('preview.proxyReady')
      : proxyStatus === 'generating'
        ? t('preview.proxyGenerating')
        : proxyStatus === 'stale'
          ? t('preview.proxyStale')
          : t('preview.proxyMissing');
  const queueTracks = getWorkspaceTracks(project.tracks);
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
    mode === 'original'
      ? t('preview.modeOriginal')
      : mode === 'processed'
        ? t('preview.modeProcessed')
        : t('preview.modeMetronome');
  const currentTargetLabel = target === 'single' ? t('preview.targetSingle') : t('preview.targetMedley');
  const canControlPreview = target === 'single' ? Boolean(selectedTrack) : queueTracks.length > 0;
  const canTogglePlayback = isPlaying || canControlPreview;
  const playbackToggleLabel = isPlaying ? t('preview.pause') : t('preview.play');
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
  const resolvedCurrentLabel =
    currentLabel === PREVIEW_SPECIAL_LABEL_MEDLEY
      ? t('preview.currentLabelMedley')
      : currentLabel === PREVIEW_SPECIAL_LABEL_GAP
        ? t('preview.currentLabelGap')
        : currentLabel;
  const previewStatusLabel = isPlaying
    ? resolvedCurrentLabel || t('preview.statusPlaying')
    : previewPositionMs > 0
      ? t('preview.statusPaused')
      : t('preview.statusIdle');
  const previewStatusTone =
    isPlaying ? 'playing' : previewPositionMs > 0 ? 'paused' : 'idle';
  const PreviewVolumeIcon = volume === 0 ? VolumeX : volume < 0.45 ? Volume1 : Volume2;
  const selectedTrackProxyStatus = selectedTrack
    ? (proxyStatusByTrackId[selectedTrack.id] ?? 'missing')
    : null;
  const selectedTargetBpm = Math.round(
    selectedPlan?.targetBpm ?? selectedTrack?.targetBpm ?? project.globalTargetBpm
  );
  const waveformRequestKey = selectedTrack
    ? [
        selectedTrack.filePath,
        selectedTrack.durationMs,
        selectedTrack.trimInMs,
        selectedTrack.trimOutMs,
        WAVEFORM_POINT_COUNT
      ].join('|')
    : '';
  const visualDurationMs = Math.max(1, selectedPlan?.processedDurationMs ?? 1);
  const waveformPeaks = waveformState.data?.peaks ?? [];
  const waveformAreaPath = buildWaveformAreaPath(waveformPeaks);
  const waveformStrokePath = buildWaveformStrokePath(waveformPeaks);
  const visualMusicBeatTimes = selectedPlan
    ? generateBeatTimes(
        visualDurationMs,
        selectedPlan.targetBpm,
        selectedPlan.downbeatOffsetMsAfterSpeed
      )
    : [];
  const visualMetronomeBeatTimes = selectedPlan
    ? generateBeatTimes(
        visualDurationMs,
        selectedPlan.metronomeBpm,
        selectedPlan.metronomeStartMs
      )
    : [];
  const barDivisor = Math.max(1, selectedPlan?.beatsPerBar ?? 4);
  const visualBarTimes = visualMusicBeatTimes.filter((_, index) => index % barDivisor === 0);
  const minorBeatStride = Math.max(1, Math.ceil(visualMusicBeatTimes.length / 96));
  const visualMinorBeatTimes = visualMusicBeatTimes.filter(
    (_, index) => index % barDivisor !== 0 && index % minorBeatStride === 0
  );
  const metronomeStride = Math.max(1, Math.ceil(visualMetronomeBeatTimes.length / 84));
  const visualMetronomeMarkers = visualMetronomeBeatTimes.filter(
    (_, index) => index % metronomeStride === 0
  );
  const visualCursorMs =
    selectedPlan && target === 'single'
      ? mode === 'original'
        ? previewPositionMs / Math.max(0.0001, selectedPlan.speedRatio)
        : previewPositionMs
      : null;
  const visualHeaderTitle = selectedTrack ? selectedTrack.name : t('preview.visualTitleEmpty');
  const visualHeaderSubtitle = !selectedTrack
    ? target === 'medley' && queueTracks.length > 0
      ? t('preview.visualSubtitleMedleyEmpty')
      : t('preview.visualSubtitleEmpty')
    : target === 'medley'
      ? t('preview.visualSubtitleMedleySelected')
      : mode === 'original'
        ? t('preview.visualSubtitleOriginal')
        : '';
  const visualHelpTooltip = selectedTrack
    ? mode === 'original'
      ? ''
      : selectedTrackProxyStatus === 'ready'
        ? t('preview.visualSubtitleProxyReady')
        : t('preview.visualSubtitleProxyMissing')
    : '';
  const visualMeta = selectedTrack
    ? [
        currentModeLabel,
        `${Math.round(selectedTrack.sourceBpm)} → ${selectedTargetBpm} BPM`,
        Math.abs(selectedTrack.metronomeOffsetMs) <= 12
          ? t('preview.offsetAligned')
          : `${t('preview.offsetDelta')}${selectedTrack.metronomeOffsetMs > 0 ? '+' : ''}${selectedTrack.metronomeOffsetMs} ms`,
        `${t('preview.downbeatLabel')}${selectedTrack.downbeatOffsetMs} ms`,
        `${t('preview.metronomeLabel')}${selectedTrack.metronomeOffsetMs} ms`
      ]
    : [
        currentTargetLabel,
        currentModeLabel,
        queueTracks.length > 0 ? `${queueTracks.length} ${t('preview.queueCountSuffix')}` : t('preview.queueEmpty'),
        `${t('preview.globalBpmLabel')}${Math.round(project.globalTargetBpm)} BPM`
      ];
  const auditionViewIndex = auditionView === 'controls' ? 0 : 1;
  const auditionViews = [
    {
      key: 'controls' as const,
      label: t('preview.controlsTab')
    },
    {
      key: 'visualizer' as const,
      label: t('preview.visualizerTab')
    }
  ];
  const targetControls = [
    {
      key: 'single',
      shortLabel: t('preview.targetSingle'),
      label: t('preview.targetSingleLabel'),
      icon: Disc3,
      active: target === 'single',
      disabled: false,
      onClick: () => onSelectTarget('single')
    },
    {
      key: 'medley',
      shortLabel: t('preview.targetMedley'),
      label: t('preview.targetMedleyLabel'),
      icon: LayoutList,
      active: target === 'medley',
      disabled: false,
      onClick: () => onSelectTarget('medley')
    }
  ];
  const modeControls = [
    {
      key: 'processed',
      shortLabel: t('preview.modeProcessedShort'),
      label: t('preview.modeProcessed'),
      icon: Gauge,
      active: mode === 'processed',
      disabled: false,
      onClick: () => onSelectMode('processed')
    },
    {
      key: 'metronome',
      shortLabel: t('preview.modeMetronomeShort'),
      label: t('preview.modeMetronome'),
      icon: AlarmClock,
      active: mode === 'metronome',
      disabled: false,
      onClick: () => onSelectMode('metronome')
    },
    {
      key: 'original',
      shortLabel: t('preview.modeOriginalShort'),
      label: t('preview.modeOriginal'),
      icon: AudioWaveform,
      active: mode === 'original',
      disabled: target === 'medley',
      onClick: () => onSelectMode('original')
    }
  ];

  const updateDropTargetState = useEffectEvent((
    next: { trackId: string; placement: 'before' | 'after' } | null
  ) => {
    const previous = dropTargetRef.current;
    if (
      previous?.trackId === next?.trackId &&
      previous?.placement === next?.placement
    ) {
      return;
    }
    dropTargetRef.current = next;
    setDropTarget(next);
  });

  const clearDragRuntime = useEffectEvent(() => {
    pointerDragStateRef.current = null;
    draggingTrackIdRef.current = null;
    dragPointerRef.current = null;
    edgeScrollDirectionRef.current = 0;
    edgeScrollEnteredAtRef.current = 0;
    setDraggedTrackId(null);
    updateDropTargetState(null);
  });

  const updateDropTargetByPointer = useEffectEvent((sourceTrackId: string, x: number, y: number) => {
    const list = queueListRef.current;
    if (!list) {
      updateDropTargetState(null);
      return;
    }

    const rect = list.getBoundingClientRect();
    const insideList = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    if (!insideList) {
      updateDropTargetState(null);
      return;
    }

    const pointerElement = document.elementFromPoint(x, y) as HTMLElement | null;
    const itemElement = pointerElement?.closest('[data-work-track-id]') as HTMLElement | null;
    const itemTrackId = itemElement?.dataset.workTrackId;

    if (itemElement && itemTrackId) {
      if (itemTrackId === sourceTrackId) {
        updateDropTargetState(null);
        return;
      }
      const itemRect = itemElement.getBoundingClientRect();
      const placement = y < itemRect.top + itemRect.height / 2 ? 'before' : 'after';
      updateDropTargetState({
        trackId: itemTrackId,
        placement
      });
      return;
    }

    const trackIds = queueTrackIdsRef.current;
    const firstTrackId = trackIds[0];
    const lastTrackId = trackIds.at(-1);
    if (!firstTrackId || !lastTrackId) {
      updateDropTargetState(null);
      return;
    }
    const placeBeforeAll = y < rect.top + rect.height / 2;
    const targetTrackId = placeBeforeAll ? firstTrackId : lastTrackId;
    if (targetTrackId === sourceTrackId) {
      updateDropTargetState(null);
      return;
    }
    updateDropTargetState({
      trackId: targetTrackId,
      placement: placeBeforeAll ? 'before' : 'after'
    });
  });

  const finalizePointerDrag = useEffectEvent((sourceTrackId: string) => {
    const target = dropTargetRef.current;
    clearDragRuntime();
    if (!target || sourceTrackId === target.trackId) {
      return;
    }
    reorderWorkTrackRef.current(sourceTrackId, target.trackId, target.placement);
  });

  useEffect(() => {
    queueTrackIdsRef.current = queueTracks.map((track) => track.id);
  }, [queueTracks]);

  useEffect(() => {
    setWaveformZoom(1);
    if (waveformScrollRef.current) {
      waveformScrollRef.current.scrollLeft = 0;
    }
  }, [waveformRequestKey]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedTrack) {
      setWaveformState({
        status: 'idle',
        data: null,
        error: ''
      });
      return () => {
        cancelled = true;
      };
    }

    const cached = waveformCacheRef.current.get(waveformRequestKey);
    if (cached) {
      setWaveformState({
        status: 'ready',
        data: cached,
        error: ''
      });
      return () => {
        cancelled = true;
      };
    }

    setWaveformState((current) => ({
      status: 'loading',
      data: current.data && waveformRequestKey ? current.data : null,
      error: ''
    }));

    void window.beatStride
      .getAudioWaveform({
        filePath: selectedTrack.filePath,
        durationMs: selectedTrack.durationMs,
        trimInMs: selectedTrack.trimInMs,
        trimOutMs: selectedTrack.trimOutMs,
        points: WAVEFORM_POINT_COUNT
      })
      .then((data) => {
        if (cancelled) {
          return;
        }
        waveformCacheRef.current.set(waveformRequestKey, data);
        setWaveformState({
          status: 'ready',
          data,
          error: ''
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setWaveformState({
          status: 'error',
          data: null,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTrack, waveformRequestKey]);

  useEffect(() => {
    reorderWorkTrackRef.current = onReorderTrack;
  }, [onReorderTrack]);

  useEffect(() => {
    if (isScrubbing) {
      return;
    }
    const nextValue = Math.max(0, Math.min(previewDurationMs, currentTimeMs));
    scrubValueRef.current = nextValue;
    setScrubValue(nextValue);
  }, [currentTimeMs, previewDurationMs, isScrubbing]);

  const commitPreviewSeek = useEffectEvent((value: number, source: SeekCommitSource) => {
    const nextPositionMs = Math.max(0, Math.min(previewDurationMs, value));
    if (source === 'change-direct') {
      suppressDirectSeekUntilRef.current = 0;
    } else {
      suppressDirectSeekUntilRef.current = performance.now() + 200;
    }
    console.info('[BeatStride][seek-ui]', {
      source,
      rawValue: value,
      committedValue: nextPositionMs,
      durationMs: previewDurationMs,
      isScrubbing: scrubbingRef.current,
      playbackPositionMs: currentTimeMs
    });
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
      if (!scrubbingRef.current) {
        return;
      }
      const nextValue = Number(previewSeekRef.current?.value ?? scrubValueRef.current);
      commitPreviewSeek(nextValue, 'window-release');
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

  useEffect(() => {
    draggingTrackIdRef.current = draggedTrackId;
    if (!draggedTrackId) {
      edgeScrollDirectionRef.current = 0;
      edgeScrollEnteredAtRef.current = 0;
    }
  }, [draggedTrackId]);

  useEffect(() => {
    const normalizeWheelDeltaY = (
      event: WheelEvent,
      list: HTMLDivElement
    ): number => {
      if (event.deltaMode === 1) {
        return event.deltaY * 16;
      }
      if (event.deltaMode === 2) {
        return event.deltaY * list.clientHeight;
      }
      return event.deltaY;
    };

    const applyDragWheelScroll = (event: Event, source: 'wheel' | 'mousewheel') => {
      const draggedTrackId = draggingTrackIdRef.current;
      if (!draggedTrackId) {
        return;
      }
      const list = queueListRef.current;
      if (!list) {
        return;
      }

      const wheelEvent = event as WheelEvent & { wheelDelta?: number };
      const fallbackDelta =
        typeof wheelEvent.wheelDelta === 'number' ? -wheelEvent.wheelDelta : 0;
      const rawDeltaY =
        wheelEvent.deltaY !== undefined
          ? normalizeWheelDeltaY(wheelEvent, list)
          : fallbackDelta;
      if (!Number.isFinite(rawDeltaY) || rawDeltaY === 0) {
        return;
      }

      const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
      const before = list.scrollTop;
      const next = Math.max(0, Math.min(maxScrollTop, before + rawDeltaY));
      list.scrollTop = next;
      console.info('[BeatStride][drag-wheel]', {
        source,
        draggedTrackId,
        rawDeltaY,
        before,
        after: list.scrollTop,
        maxScrollTop
      });
      if (next === before) {
        return;
      }
      event.preventDefault();
    };

    const handleWheelWhileDragging = (event: WheelEvent) => {
      applyDragWheelScroll(event, 'wheel');
    };

    const handleMouseWheelWhileDragging = (event: Event) => {
      applyDragWheelScroll(event, 'mousewheel');
    };

    window.addEventListener('wheel', handleWheelWhileDragging, {
      passive: false,
      capture: true
    });
    window.addEventListener('mousewheel', handleMouseWheelWhileDragging, {
      passive: false,
      capture: true
    });
    document.addEventListener('wheel', handleWheelWhileDragging, {
      passive: false,
      capture: true
    });
    document.addEventListener('mousewheel', handleMouseWheelWhileDragging, {
      passive: false,
      capture: true
    });
    return () => {
      window.removeEventListener('wheel', handleWheelWhileDragging, true);
      window.removeEventListener('mousewheel', handleMouseWheelWhileDragging, true);
      document.removeEventListener('wheel', handleWheelWhileDragging, true);
      document.removeEventListener('mousewheel', handleMouseWheelWhileDragging, true);
    };
  }, []);

  useEffect(() => {
    const DRAG_START_THRESHOLD_PX = 4;

    const handlePointerMove = (event: PointerEvent) => {
      const state = pointerDragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) {
        return;
      }

      const primaryButtonPressed = (event.buttons & 1) === 1;
      if (!primaryButtonPressed) {
        if (state.started) {
          clearDragRuntime();
        } else {
          pointerDragStateRef.current = null;
          dragPointerRef.current = null;
        }
        return;
      }

      dragPointerRef.current = { x: event.clientX, y: event.clientY };

      if (!state.started) {
        const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
        if (distance < DRAG_START_THRESHOLD_PX) {
          return;
        }
        state.started = true;
        draggingTrackIdRef.current = state.trackId;
        setDraggedTrackId(state.trackId);
        console.info('[BeatStride][drag-wheel]', {
          status: 'drag-start',
          trackId: state.trackId,
          mode: 'pointer'
        });
      }

      updateDropTargetByPointer(state.trackId, event.clientX, event.clientY);
      event.preventDefault();
    };

    const handlePointerUp = (event: PointerEvent) => {
      const state = pointerDragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) {
        return;
      }

      if (state.started) {
        finalizePointerDrag(state.trackId);
        console.info('[BeatStride][drag-wheel]', {
          status: 'drag-end',
          trackId: state.trackId,
          mode: 'pointer'
        });
      } else {
        pointerDragStateRef.current = null;
      }
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const state = pointerDragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) {
        return;
      }
      clearDragRuntime();
      console.info('[BeatStride][drag-wheel]', {
        status: 'drag-cancel',
        trackId: state.trackId,
        mode: 'pointer'
      });
    };

    window.addEventListener('pointermove', handlePointerMove, {
      passive: false,
      capture: true
    });
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerCancel, true);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
    };
  }, [clearDragRuntime, finalizePointerDrag, updateDropTargetByPointer]);

  useEffect(() => {
    const tick = () => {
      const draggedTrackId = draggingTrackIdRef.current;
      const list = queueListRef.current;
      const pointer = dragPointerRef.current;
      if (!draggedTrackId || !list || !pointer) {
        edgeScrollDirectionRef.current = 0;
        edgeScrollEnteredAtRef.current = 0;
        edgeAutoScrollFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }

      const rect = list.getBoundingClientRect();
      const pointerInsideList =
        pointer.x >= rect.left &&
        pointer.x <= rect.right &&
        pointer.y >= rect.top &&
        pointer.y <= rect.bottom;

      let nextDirection: -1 | 0 | 1 = 0;
      let distanceToEdge = EDGE_AUTO_SCROLL_THRESHOLD_PX;
      if (pointerInsideList) {
        const distanceToTop = pointer.y - rect.top;
        const distanceToBottom = rect.bottom - pointer.y;
        if (distanceToTop < EDGE_AUTO_SCROLL_THRESHOLD_PX) {
          nextDirection = -1;
          distanceToEdge = distanceToTop;
        } else if (distanceToBottom < EDGE_AUTO_SCROLL_THRESHOLD_PX) {
          nextDirection = 1;
          distanceToEdge = distanceToBottom;
        }
      }

      if (nextDirection !== edgeScrollDirectionRef.current) {
        edgeScrollDirectionRef.current = nextDirection;
        edgeScrollEnteredAtRef.current =
          nextDirection === 0 ? 0 : performance.now();
        console.info('[BeatStride][drag-autoscroll]', {
          trackId: draggedTrackId,
          status: nextDirection === 0 ? 'edge-leave' : 'edge-enter',
          direction: nextDirection
        });
      }

      if (nextDirection !== 0) {
        const heldMs = performance.now() - edgeScrollEnteredAtRef.current;
        if (heldMs >= EDGE_AUTO_SCROLL_HOLD_MS) {
          const intensity = Math.max(
            0,
            Math.min(
              1,
              (EDGE_AUTO_SCROLL_THRESHOLD_PX - Math.max(0, distanceToEdge)) /
                EDGE_AUTO_SCROLL_THRESHOLD_PX
            )
          );
          const step =
            EDGE_AUTO_SCROLL_MIN_STEP_PX +
            (EDGE_AUTO_SCROLL_MAX_STEP_PX - EDGE_AUTO_SCROLL_MIN_STEP_PX) *
              intensity;
          const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
          const before = list.scrollTop;
          const after = Math.max(
            0,
            Math.min(maxScrollTop, before + nextDirection * step)
          );
          if (after !== before) {
            list.scrollTop = after;
          }
        }
      }

      if (pointer) {
        updateDropTargetByPointer(draggedTrackId, pointer.x, pointer.y);
      }

      edgeAutoScrollFrameRef.current = window.requestAnimationFrame(tick);
    };

    edgeAutoScrollFrameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (edgeAutoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(edgeAutoScrollFrameRef.current);
      }
      edgeAutoScrollFrameRef.current = null;
    };
  }, [updateDropTargetByPointer]);

  const handleQueuePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    trackId: string
  ) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('.preview-item-check')) {
      return;
    }
    pointerDragStateRef.current = {
      trackId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      started: false
    };
    dragPointerRef.current = { x: event.clientX, y: event.clientY };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Ignore pointer-capture failures in unsupported environments.
    }
  };

  const startPreviewSeek = (event: ReactPointerEvent<HTMLInputElement>) => {
    clearDragRuntime();
    console.info('[BeatStride][seek-ui]', {
      source: 'pointer-down',
      value: Number(event.currentTarget.value),
      durationMs: previewDurationMs,
      playbackPositionMs: currentTimeMs
    });
    scrubbingRef.current = true;
    setIsScrubbing(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Ignore pointer-capture failures on range inputs.
    }
  };

  const finishPreviewSeek = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (!scrubbingRef.current) {
      return;
    }
    commitPreviewSeek(Number(event.currentTarget.value), 'range-release');
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore pointer-capture release failures.
    }
  };

  const handlePreviewSeekChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = Number(event.target.value);
    scrubValueRef.current = nextValue;
    setScrubValue(nextValue);
    if (!scrubbingRef.current) {
      if (performance.now() < suppressDirectSeekUntilRef.current) {
        console.info('[BeatStride][seek-ui]', {
          source: 'change-direct-suppressed',
          rawValue: nextValue,
          suppressUntil: suppressDirectSeekUntilRef.current
        });
        return;
      }
      commitPreviewSeek(nextValue, 'change-direct');
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

  const handleWaveformWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) {
      return;
    }

    const container = waveformScrollRef.current;
    if (!container) {
      return;
    }

    event.preventDefault();
    const nextZoom = clampToRange(
      Number((waveformZoom * (event.deltaY < 0 ? 1.14 : 1 / 1.14)).toFixed(3)),
      MIN_WAVEFORM_ZOOM,
      MAX_WAVEFORM_ZOOM
    );

    if (Math.abs(nextZoom - waveformZoom) < 0.001) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const pointerOffsetX = event.clientX - rect.left;
    const previousScrollWidth = Math.max(container.scrollWidth, 1);
    const anchorRatio = clampToRange(
      (container.scrollLeft + pointerOffsetX) / previousScrollWidth,
      0,
      1
    );

    setWaveformZoom(nextZoom);
    requestAnimationFrame(() => {
      const nextScrollWidth = Math.max(container.scrollWidth, 1);
      container.scrollLeft = Math.max(
        0,
        anchorRatio * nextScrollWidth - pointerOffsetX
      );
    });
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
                <span>{t('common.selectAll')}</span>
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
            <div className="preview-canvas-title-center">
              <strong className="section-title">{t('preview.queueTitle')}</strong>
            </div>
            <div className="preview-canvas-tools">
              <span className="preview-canvas-count">
                {t('preview.queueCountPrefix')}
                {queueTracks.length}
                {t('preview.queueCountUnit')}
              </span>
              <button
                className="wire-btn"
                disabled={queueCheckedCount === 0}
                onClick={onRemoveCheckedFromQueue}
              >
                {t('library.removeFromQueue')}
              </button>
            </div>
          </div>
          <div
            ref={queueListRef}
            className="preview-canvas-list"
          >
            {queueTracks.length === 0 ? (
              <div className="preview-canvas-empty">{t('preview.queueEmptyHint')}</div>
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
                    data-work-track-id={track.id}
                    className={`preview-canvas-item ${selected ? 'selected' : ''} ${active ? 'active' : ''} ${draggedTrackId === track.id ? 'dragging' : ''} ${dropTarget?.trackId === track.id ? `drop-${dropTarget.placement}` : ''}`}
                    onClick={() => onSelectTrack(track.id)}
                    onPointerDown={(event) => handleQueuePointerDown(event, track.id)}
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
                      <strong className="preview-canvas-item-title">
                        {String(index + 1).padStart(2, '0')} {track.name}
                      </strong>
                      <div className="preview-canvas-item-meta muted">
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
          <div className="preview-audition-tabs">
            <div className="preview-audition-tabs-track" role="tablist" aria-label={t('preview.tabAria')}>
              {auditionViews.map((view) => (
                <button
                  key={view.key}
                  type="button"
                  role="tab"
                  aria-selected={auditionView === view.key}
                  className={`preview-audition-tab ${auditionView === view.key ? 'active' : ''}`}
                  onClick={() => setAuditionView(view.key)}
                >
                  {view.label}
                </button>
              ))}
            </div>
          </div>

          <div className="preview-audition-viewport">
            <div
              className="preview-audition-pages"
              style={{ transform: `translateX(-${auditionViewIndex * 50}%)` }}
            >
              <div className="preview-audition-page">
                <div className="preview-function-strip">
                  <div className="preview-icon-strip">
                    <div className="preview-toggle-group">
                      <span className="preview-toggle-group-label">{t('preview.targetGroup')}</span>
                      <div className="preview-icon-cluster" role="group" aria-label={t('preview.targetGroupAria')}>
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
                              <Icon size={16} strokeWidth={2.2} />
                              <span className="preview-toggle-label">{control.shortLabel}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <span className="preview-icon-divider" aria-hidden="true" />
                    <div className="preview-toggle-group">
                      <span className="preview-toggle-group-label">{t('preview.modeGroup')}</span>
                      <div className="preview-icon-cluster" role="group" aria-label={t('preview.modeGroupAria')}>
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
                              <Icon size={16} strokeWidth={2.2} />
                              <span className="preview-toggle-label">{control.shortLabel}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="preview-transport">
                  <div className="preview-deck">
                    <div className="preview-play-cluster compact" role="group" aria-label={t('preview.transportAria')}>
                      <button
                        type="button"
                        className="transport-button transport-utility"
                        aria-label={t('preview.backTen')}
                        title={t('preview.backTen')}
                        disabled={!canControlPreview}
                        onClick={() => handlePreviewStep(-10000)}
                      >
                        <SkipBack size={18} strokeWidth={2.2} />
                      </button>
                      <button
                        type="button"
                        className={`transport-button transport-core ${isPlaying ? 'active' : ''}`}
                        aria-label={playbackToggleLabel}
                        title={playbackToggleLabel}
                        disabled={!canTogglePlayback}
                        onClick={isPlaying ? onPause : target === 'single' ? onPlaySingle : onPlayMedley}
                      >
                        {isPlaying ? <Pause size={18} strokeWidth={2.35} /> : <Play size={20} strokeWidth={2.35} />}
                      </button>
                      <button
                        type="button"
                        className="transport-button transport-utility stop"
                        aria-label={t('preview.stop')}
                        title={t('preview.stop')}
                        disabled={!canControlPreview || (!isPlaying && previewPositionMs <= 0)}
                        onClick={onStop}
                      >
                        <CircleStop size={16} strokeWidth={2.2} />
                      </button>
                      <button
                        type="button"
                        className="transport-button transport-utility"
                        aria-label={t('preview.forwardTen')}
                        title={t('preview.forwardTen')}
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
                        aria-label={t('preview.volume')}
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
                          aria-label={t('preview.progress')}
                          style={{ '--progress-percent': previewProgressPercent } as CSSProperties}
                          onPointerDown={startPreviewSeek}
                          onPointerUp={finishPreviewSeek}
                          onPointerCancel={finishPreviewSeek}
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
              </div>
              <div className="preview-audition-page">
                <div className="preview-visualizer">
                  <div className="preview-visualizer-card">
                    <div className="preview-visualizer-header">
                      <div className="preview-visualizer-heading">
                        <span className="preview-visualizer-kicker">{t('preview.visualizerKicker')}</span>
                        <strong className="preview-visualizer-title" title={visualHeaderTitle}>
                          {visualHeaderTitle}
                        </strong>
                        <span className="preview-visualizer-subtitle">{visualHeaderSubtitle}</span>
                      </div>
                      <div className="preview-visualizer-meta">
                        {visualMeta.map((item) => (
                          <span key={item} className="preview-visualizer-chip">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>

                    {selectedTrack && selectedPlan ? (
                      <>
                        <div className="preview-visualizer-tools">
                          <div className="preview-visualizer-hint-wrap">
                            <span className="preview-visualizer-hint">{t('preview.visualHint')}</span>
                            {visualHelpTooltip ? (
                              <span
                                className="preview-visualizer-help"
                                aria-label={visualHelpTooltip}
                                title={visualHelpTooltip}
                                tabIndex={0}
                              >
                                ?
                                <span className="preview-visualizer-help-tooltip" role="tooltip">
                                  {visualHelpTooltip}
                                </span>
                              </span>
                            ) : null}
                          </div>
                          <span className="preview-visualizer-zoom">
                            {t('preview.zoomPrefix')}
                            {waveformZoom.toFixed(1)}x
                          </span>
                        </div>

                        <div
                          ref={waveformScrollRef}
                          className="preview-visualizer-scroll"
                          onWheel={handleWaveformWheel}
                        >
                          <div
                            className="preview-visualizer-canvas"
                            style={{ width: `${Math.max(100, waveformZoom * 100)}%` }}
                          >
                            <div className="preview-visualizer-ruler" aria-hidden="true">
                              {RULER_STOPS.map((stop) => (
                                <span
                                  key={stop}
                                  className="preview-visualizer-ruler-label"
                                  style={{ left: `${stop * 100}%` }}
                                >
                                  {formatMs(visualDurationMs * stop)}
                                </span>
                              ))}
                            </div>

                            <div className="preview-visualizer-stage">
                              <div className="preview-waveform">
                                {waveformState.status === 'ready' && waveformAreaPath ? (
                                  <svg
                                    className="preview-waveform-svg"
                                    viewBox={`0 0 ${WAVEFORM_VIEWBOX_WIDTH} ${WAVEFORM_VIEWBOX_HEIGHT}`}
                                    preserveAspectRatio="none"
                                    aria-label={t('preview.waveformAria')}
                                  >
                                    <path className="preview-waveform-fill" d={waveformAreaPath} />
                                    <path className="preview-waveform-stroke" d={waveformStrokePath} />
                                    <line
                                      className="preview-waveform-centerline"
                                      x1="0"
                                      x2={String(WAVEFORM_VIEWBOX_WIDTH)}
                                      y1={String(WAVEFORM_CENTER_Y)}
                                      y2={String(WAVEFORM_CENTER_Y)}
                                    />
                                  </svg>
                                ) : waveformState.status === 'loading' ? (
                                  <div className="preview-waveform-status">{t('preview.waveformLoading')}</div>
                                ) : waveformState.status === 'error' ? (
                                  <div className="preview-waveform-status error">
                                    {t('preview.waveformError')}
                                    {waveformState.error}
                                  </div>
                                ) : (
                                  <div className="preview-waveform-status">{t('preview.waveformIdle')}</div>
                                )}
                              </div>

                              {visualMinorBeatTimes.map((timeMs, index) => (
                                <span
                                  key={`${selectedTrack.id}-minor-${index}-${timeMs}`}
                                  className="preview-grid-line preview-grid-line-minor"
                                  style={{ left: `${toPercent(timeMs, visualDurationMs)}%` }}
                                />
                              ))}

                              {visualBarTimes.map((timeMs, index) => (
                                <span
                                  key={`${selectedTrack.id}-bar-${index}-${timeMs}`}
                                  className="preview-grid-line preview-grid-line-bar"
                                  style={{ left: `${toPercent(timeMs, visualDurationMs)}%` }}
                                />
                              ))}

                              {visualMetronomeMarkers.map((timeMs, index) => (
                                <span
                                  key={`${selectedTrack.id}-metro-${index}-${timeMs}`}
                                  className="preview-metronome-dot"
                                  style={{ left: `${toPercent(timeMs, visualDurationMs)}%` }}
                                />
                              ))}

                              <span
                                className="preview-marker-line downbeat"
                                style={{
                                  left: `${toPercent(selectedPlan.downbeatOffsetMsAfterSpeed, visualDurationMs)}%`
                                }}
                              />
                              <span
                                className="preview-marker-label downbeat"
                                style={{
                                  left: `${toPercent(selectedPlan.downbeatOffsetMsAfterSpeed, visualDurationMs)}%`
                                }}
                              >
                                {t('preview.downbeatMarker')}
                              </span>

                              <span
                                className="preview-marker-line metronome"
                                style={{ left: `${toPercent(selectedPlan.metronomeStartMs, visualDurationMs)}%` }}
                              />
                              <span
                                className="preview-marker-label metronome"
                                style={{ left: `${toPercent(selectedPlan.metronomeStartMs, visualDurationMs)}%` }}
                              >
                                {t('preview.metronomeMarker')}
                              </span>

                              {visualCursorMs !== null && (
                                <>
                                  <span
                                    className="preview-marker-line playhead"
                                    style={{ left: `${toPercent(visualCursorMs, visualDurationMs)}%` }}
                                  />
                                  <span
                                    className="preview-marker-label playhead"
                                    style={{ left: `${toPercent(visualCursorMs, visualDurationMs)}%` }}
                                  >
                                    {t('preview.playheadMarker')}
                                    {formatMs(visualCursorMs)}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="preview-visualizer-legend">
                          <span className="preview-visualizer-legend-item">
                            <span className="preview-visualizer-legend-swatch waveform" />
                            {t('preview.legendWaveform')}
                          </span>
                          <span className="preview-visualizer-legend-item">
                            <span className="preview-visualizer-legend-swatch bar" />
                            {t('preview.legendBar')}
                          </span>
                          <span className="preview-visualizer-legend-item">
                            <span className="preview-visualizer-legend-swatch minor" />
                            {t('preview.legendMinor')}
                          </span>
                          <span className="preview-visualizer-legend-item">
                            <span className="preview-visualizer-legend-swatch metronome" />
                            {t('preview.legendMetronome')}
                          </span>
                          <span className="preview-visualizer-legend-item">
                            <span className="preview-visualizer-legend-swatch playhead" />
                            {t('preview.legendPlayhead')}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="preview-visualizer-empty">
                        <strong>{t('preview.visualEmptyTitle')}</strong>
                        <span>{t('preview.visualEmptyBody')}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
