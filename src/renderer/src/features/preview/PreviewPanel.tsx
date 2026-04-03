import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
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
import type { ProjectFile, Track, TrackProxyStatus } from '@shared/types';
import { buildProjectPreviewPlan, buildSingleTrackPreviewPlan } from '@shared/services/previewPlanService';
import { getWorkspaceTracks } from '@shared/services/workspaceOrderService';
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

const WAVEFORM_BAR_COUNT = 72;
const RULER_STOPS = [0, 0.25, 0.5, 0.75, 1];

function clampToRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function buildWaveformBars(trackName: string, durationMs: number, beatIntervalMs: number): number[] {
  const seed = hashString(`${trackName}:${Math.round(durationMs)}`);
  const safeDurationMs = Math.max(1, durationMs);
  const safeBeatIntervalMs = Math.max(240, beatIntervalMs);

  return Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
    const ratio = WAVEFORM_BAR_COUNT <= 1 ? 0 : index / (WAVEFORM_BAR_COUNT - 1);
    const timeMs = ratio * safeDurationMs;
    const beatPhase = ((timeMs / safeBeatIntervalMs) + seed * 0.00037) % 1;
    const beatPulse = 1 - Math.min(Math.abs(beatPhase), Math.abs(1 - beatPhase)) * 2;
    const slowTexture = 0.5 + 0.5 * Math.sin(ratio * Math.PI * 4 + seed * 0.0019);
    const fastTexture = 0.5 + 0.5 * Math.sin(ratio * Math.PI * 18 + seed * 0.0041);
    const sectionLift = 0.5 + 0.5 * Math.sin(ratio * Math.PI * 2 - Math.PI / 3);
    const centerLift = 1 - Math.abs(ratio - 0.5) * 0.55;
    const amplitude = clampToRange(
      0.16 +
        beatPulse * 0.3 +
        slowTexture * 0.2 +
        fastTexture * 0.16 +
        sectionLift * 0.14 +
        centerLift * 0.12,
      0.14,
      0.96
    );
    return Number(amplitude.toFixed(3));
  });
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
  const EDGE_AUTO_SCROLL_THRESHOLD_PX = 44;
  const EDGE_AUTO_SCROLL_HOLD_MS = 220;
  const EDGE_AUTO_SCROLL_MIN_STEP_PX = 4;
  const EDGE_AUTO_SCROLL_MAX_STEP_PX = 22;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const queueListRef = useRef<HTMLDivElement | null>(null);
  const previewSeekRef = useRef<HTMLInputElement | null>(null);
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
  type SeekCommitSource = 'window-release' | 'range-release' | 'change-direct';
  const getProxyStatusLabel = (proxyStatus: TrackProxyStatus) =>
    proxyStatus === 'ready'
      ? '代理已生成'
      : proxyStatus === 'generating'
        ? '代理生成中'
        : proxyStatus === 'stale'
          ? '代理已过期'
          : '未生成代理';
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
    mode === 'original' ? '原曲对比' : mode === 'processed' ? '变速试听' : '节拍器叠加';
  const currentTargetLabel = target === 'single' ? '单曲' : '串烧';
  const canControlPreview = target === 'single' ? Boolean(selectedTrack) : queueTracks.length > 0;
  const canTogglePlayback = isPlaying || canControlPreview;
  const playbackToggleLabel = isPlaying ? '暂停' : '播放';
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
  const visualDurationMs = Math.max(1, selectedPlan?.processedDurationMs ?? 1);
  const visualBeatIntervalMs = selectedPlan ? 60000 / Math.max(1, selectedPlan.targetBpm) : 0;
  const waveformBars =
    selectedTrack && selectedPlan
      ? buildWaveformBars(selectedTrack.name, visualDurationMs, visualBeatIntervalMs)
      : [];
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
  const visualHeaderTitle = selectedTrack ? selectedTrack.name : '先从工作区选择一首歌';
  const visualHeaderSubtitle = !selectedTrack
    ? target === 'medley' && queueTracks.length > 0
      ? '先在工作区点选一首歌，这里会显示它的简化波形、首拍线和节拍器落点。'
      : '选中歌曲后，就能直接观察首拍和节拍器的相对位置，而不是只看数字。'
    : target === 'medley'
      ? '当前显示选中歌曲的处理时间轴，串烧试听不会改变这里的校准参考。'
      : mode === 'original'
        ? '当前播放是原曲对比，但下方仍按变速后的校准时间轴显示首拍与节拍器关系。'
        : selectedTrackProxyStatus === 'ready'
          ? '这里按处理后的时间轴展示首拍、拍线和节拍器落点，适合直接判断是否贴拍。'
          : '先在这里确认对齐关系，没问题后再生成代理或继续串烧试听。';
  const visualMeta = selectedTrack
    ? [
        currentModeLabel,
        `${Math.round(selectedTrack.sourceBpm)} → ${selectedTargetBpm} BPM`,
        `首拍 ${selectedTrack.downbeatOffsetMs} ms`,
        `节拍器 ${selectedTrack.metronomeOffsetMs} ms`
      ]
    : [
        currentTargetLabel,
        currentModeLabel,
        queueTracks.length > 0 ? `${queueTracks.length} 首工作区` : '工作区为空',
        `全局 ${Math.round(project.globalTargetBpm)} BPM`
      ];
  const auditionViewIndex = auditionView === 'controls' ? 0 : 1;
  const auditionViews = [
    {
      key: 'controls' as const,
      label: '试听控制'
    },
    {
      key: 'visualizer' as const,
      label: '节拍校准'
    }
  ];
  const targetControls = [
    {
      key: 'single',
      shortLabel: '单曲',
      label: '单曲试听',
      icon: Disc3,
      active: target === 'single',
      disabled: false,
      onClick: () => onSelectTarget('single')
    },
    {
      key: 'medley',
      shortLabel: '串烧',
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
      shortLabel: '变速',
      label: '变速试听',
      icon: Gauge,
      active: mode === 'processed',
      disabled: false,
      onClick: () => onSelectMode('processed')
    },
    {
      key: 'metronome',
      shortLabel: '节拍器',
      label: '添加节拍器',
      icon: AlarmClock,
      active: mode === 'metronome',
      disabled: false,
      onClick: () => onSelectMode('metronome')
    },
    {
      key: 'original',
      shortLabel: '原曲',
      label: '原曲对比',
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
          <div
            ref={queueListRef}
            className="preview-canvas-list"
          >
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
          <div className="preview-audition-tabs">
            <div className="preview-audition-tabs-track" role="tablist" aria-label="工作区界面切换">
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
                      <span className="preview-toggle-group-label">目标</span>
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
                              <Icon size={16} strokeWidth={2.2} />
                              <span className="preview-toggle-label">{control.shortLabel}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <span className="preview-icon-divider" aria-hidden="true" />
                    <div className="preview-toggle-group">
                      <span className="preview-toggle-group-label">模式</span>
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
                        <span className="preview-visualizer-kicker">节拍校准视图</span>
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
                            {waveformBars.map((height, index) => (
                              <span
                                key={`${selectedTrack.id}-wave-${index}`}
                                className="preview-waveform-bar"
                                style={{ '--wave-height': height } as CSSProperties}
                              />
                            ))}
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
                            首拍
                          </span>

                          <span
                            className="preview-marker-line metronome"
                            style={{ left: `${toPercent(selectedPlan.metronomeStartMs, visualDurationMs)}%` }}
                          />
                          <span
                            className="preview-marker-label metronome"
                            style={{ left: `${toPercent(selectedPlan.metronomeStartMs, visualDurationMs)}%` }}
                          >
                            节拍器
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
                                播放头 {formatMs(visualCursorMs)}
                              </span>
                            </>
                          )}
                        </div>

                        <div className="preview-visualizer-legend">
                          <span className="preview-visualizer-legend-item">
                            <span className="preview-visualizer-legend-swatch waveform" />
                            简化波形
                          </span>
                          <span className="preview-visualizer-legend-item">
                            <span className="preview-visualizer-legend-swatch bar" />
                            小节线
                          </span>
                          <span className="preview-visualizer-legend-item">
                            <span className="preview-visualizer-legend-swatch minor" />
                            节拍线
                          </span>
                          <span className="preview-visualizer-legend-item">
                            <span className="preview-visualizer-legend-swatch metronome" />
                            节拍器落点
                          </span>
                          <span className="preview-visualizer-legend-item">
                            <span className="preview-visualizer-legend-swatch playhead" />
                            当前播放头
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="preview-visualizer-empty">
                        <strong>选中一首歌后，这里会出现节拍对齐视图</strong>
                        <span>你可以直接看首拍线和节拍器线是否贴近，再决定去右侧微调偏移。</span>
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
