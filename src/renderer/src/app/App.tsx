import { useEffect, useRef, useState, type DragEventHandler } from 'react';
import { WORKSPACE_TRACK_DRAG_MIME } from '@shared/constants';
import { buildSingleTrackExportPlan } from '@shared/services/exportPlanService';
import {
  buildProjectPreviewExportPlan,
  buildSingleTrackPreviewPlan
} from '@shared/services/previewPlanService';
import { getWorkspaceTracks } from '@shared/services/workspaceOrderService';
import type { SingleTrackExportPlan, TrackProxyStatus } from '@shared/types';
import { I18nProvider } from '@renderer/features/i18n/I18nProvider';
import { ThemeProvider } from '@renderer/features/theme/ThemeProvider';
import { useAppSettingsStore } from '@renderer/stores/appSettingsStore';
import {
  startProjectAutosave,
  stopProjectAutosave,
  useProjectStore
} from '@renderer/stores/projectStore';
import { usePlaybackStore } from '@renderer/stores/playbackStore';
import { useExportStore } from '@renderer/stores/exportStore';
import { TitleBar } from '@renderer/components/TitleBar';
import { WelcomePage } from '@renderer/components/WelcomePage';
import { TrackLibraryPanel } from '@renderer/features/library/TrackLibraryPanel';
import { PreviewPanel } from '@renderer/features/preview/PreviewPanel';
import { InspectorPanel } from '@renderer/components/InspectorPanel';
import { SettingsPage } from '@renderer/features/settings/SettingsPage';
import { ExportPanel } from '@renderer/features/export/ExportPanel';
import { useI18n } from '@renderer/features/i18n/I18nProvider';

type PageMode = 'welcome' | 'editor';
const TRACK_PROXY_BITRATE_KBPS = 160;
const MIN_IMPORT_CONCURRENCY = 2;
const MAX_IMPORT_CONCURRENCY = 8;

interface ProxyGenerationState {
  total: number;
  completed: number;
  failed: number;
  currentTrackName: string;
  cancelRequested: boolean;
}

async function mapWithConcurrency<TInput, TResult>(
  items: TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TResult>
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<TResult>(items.length);
  const limit = Math.max(1, Math.min(items.length, concurrency));
  let cursor = 0;

  const runWorker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

function EditorContent({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useI18n();
  const projectStore = useProjectStore();
  const playbackStore = usePlaybackStore();
  const exportStore = useExportStore();
  const [showExport, setShowExport] = useState(false);
  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(360);
  const [resizing, setResizing] = useState<null | 'left' | 'right'>(null);
  const [importing, setImporting] = useState(false);
  const [generatingTrackProxies, setGeneratingTrackProxies] = useState(false);
  const [proxyStatusByTrackId, setProxyStatusByTrackId] = useState<Record<string, TrackProxyStatus>>({});
  const [proxyGenerationState, setProxyGenerationState] = useState<ProxyGenerationState>({
    total: 0,
    completed: 0,
    failed: 0,
    currentTrackName: '',
    cancelRequested: false
  });
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const proxyGenerationCancelRef = useRef(false);

  const project = projectStore.project;
  const tracks = project?.tracks ?? [];
  const workspaceTracks = getWorkspaceTracks(tracks);
  const pendingTracks = tracks.filter((track) => !track.exportEnabled);
  const selectedTrack = tracks.find(
    (item) => item.id === projectStore.activeTimelineTrackId
  );

  const handleImportFiles = async (filePaths?: string[]) => {
    const paths = filePaths ?? (await window.beatStride.selectAudioFiles());
    if (paths.length === 0) {
      return;
    }
    if (!projectStore.project) {
      await projectStore.createProject();
    }
    const currentProject = useProjectStore.getState().project;
    const analysisSeconds = currentProject?.mixTuning.analysisSeconds ?? 120;
    const beatsPerBar = currentProject?.mixTuning.beatsPerBar ?? 4;

    setImporting(true);
    try {
      const hardwareConcurrency =
        typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)
          ? navigator.hardwareConcurrency
          : MAX_IMPORT_CONCURRENCY;
      const importConcurrency = Math.max(
        MIN_IMPORT_CONCURRENCY,
        Math.min(MAX_IMPORT_CONCURRENCY, Math.ceil(hardwareConcurrency / 2))
      );

      const probed = await mapWithConcurrency(
        paths,
        importConcurrency,
        async (filePath) => {
          const [probe, tempo] = await Promise.all([
            window.beatStride.probeAudio(filePath),
            window.beatStride.detectTempo(filePath, analysisSeconds, beatsPerBar).catch(() => ({
              bpm: 0,
              confidence: 0,
              firstBeatMs: 0,
              downbeatOffsetMs: 0
            }))
          ]);

          return {
            filePath,
            probe,
            detectedBpm: tempo.bpm > 0 ? tempo.bpm : undefined,
            downbeatOffsetMs: tempo.downbeatOffsetMs > 0 ? tempo.downbeatOffsetMs : 0
          };
        }
      );
      projectStore.addTracksFromFiles(probed);
    } finally {
      setImporting(false);
    }
  };

  const handleImportFolder = async () => {
    const paths = await window.beatStride.selectAudioFolder();
    await handleImportFiles(paths);
  };

  const handleSwitchMode = (mode: typeof playbackStore.mode) => {
    if (!project) {
      return;
    }
    const playback = usePlaybackStore.getState();
    const previousMode = playback.mode;
    let startPreviewMs = playback.currentTimeMs;

    if (
      playback.target === 'single' &&
      selectedTrack &&
      previousMode !== mode
    ) {
      const previewPlan = buildSingleTrackPreviewPlan(selectedTrack, project);
      const speedRatio = Math.max(0.0001, previewPlan.speedRatio);

      if (previousMode === 'original' && mode !== 'original') {
        startPreviewMs = Math.round(startPreviewMs / speedRatio);
      } else if (previousMode !== 'original' && mode === 'original') {
        startPreviewMs = Math.round(startPreviewMs * speedRatio);
      }

      const nextDurationMs =
        mode === 'original'
          ? previewPlan.trimmedSourceDurationMs
          : previewPlan.processedDurationMs;
      startPreviewMs = Math.max(0, Math.min(startPreviewMs, nextDurationMs));
    }

    playbackStore.setMode(mode);

    if (!playback.isPlaying || previousMode === mode) {
      return;
    }
    if (playback.target === 'single') {
      if (selectedTrack) {
        void playbackStore.playTrack(selectedTrack, project, { startPreviewMs });
      }
      return;
    }
    void playbackStore.playMedley(project, { startPreviewMs });
  };

  const formatProxyGenerationTitle = () => {
    if (!generatingTrackProxies) {
      return '为勾选歌曲生成可复用代理文件';
    }
    const { completed, total, failed, currentTrackName, cancelRequested } = proxyGenerationState;
    return [
      `进度: ${completed}/${total}`,
      `失败: ${failed}`,
      currentTrackName ? `当前: ${currentTrackName}` : '',
      cancelRequested ? '已请求停止，当前歌曲处理完后结束' : '再次点击可停止生成'
    ]
      .filter(Boolean)
      .join('\n');
  };

  const summarizeProxyError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const match =
      message.match(/Error:\s*([^\r\n]+)/i) ??
      message.match(/Invalid argument/i) ??
      message.match(/unknown filter/i);
    if (match) {
      return typeof match[0] === 'string' ? match[0] : message;
    }
    const lines = message
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.slice(-3).join(' | ') || message;
  };

  const handleGenerateTrackProxies = async () => {
    if (!project) {
      return;
    }
    if (generatingTrackProxies) {
      proxyGenerationCancelRef.current = true;
      setProxyGenerationState((state) => ({
        ...state,
        cancelRequested: true
      }));
      return;
    }
    const generateTrackProxiesApi = (
      window.beatStride as typeof window.beatStride & {
        generateTrackProxies?: typeof window.beatStride.generateTrackProxies;
      }
    ).generateTrackProxies;
    if (typeof generateTrackProxiesApi !== 'function') {
      alert('当前进程还没有加载新的代理文件接口，请完全重启应用后再试。');
      return;
    }
    const checkedWorkTracks = workspaceTracks.filter((track) =>
      projectStore.libraryCheckedIds.includes(track.id)
    );
    const targetTracks =
      checkedWorkTracks.length > 0
        ? checkedWorkTracks
        : selectedTrack && selectedTrack.exportEnabled
          ? [selectedTrack]
          : [];

    if (targetTracks.length === 0) {
      return;
    }

    let currentProject: typeof projectStore.project = project;
    if (!currentProject.meta.filePath) {
      await projectStore.saveProject();
      currentProject = useProjectStore.getState().project;
    }
    if (!currentProject?.meta.filePath) {
      alert('请先保存项目，再生成代理文件。');
      return;
    }
    const savedProject = currentProject;

    const plans = targetTracks.map((track) =>
      buildSingleTrackExportPlan(track, {
        globalTargetBpm: savedProject.globalTargetBpm,
        outputDir: '',
        format: 'mp3',
        metronomeSamplePath: savedProject.defaultMetronomeSamplePath,
        normalizeLoudness: false,
        projectFilePath: savedProject.meta.filePath,
        mixTuning: savedProject.mixTuning
      })
    );

    proxyGenerationCancelRef.current = false;
    setGeneratingTrackProxies(true);
    setProxyGenerationState({
      total: plans.length,
      completed: 0,
      failed: 0,
      currentTrackName: '',
      cancelRequested: false
    });
    try {
      const results: Awaited<ReturnType<typeof generateTrackProxiesApi>> = [];
      const failures: string[] = [];

      for (const plan of plans) {
        if (proxyGenerationCancelRef.current) {
          break;
        }

        const previousStatus = proxyStatusByTrackId[plan.track.trackId] ?? 'missing';
        setProxyGenerationState((state) => ({
          ...state,
          currentTrackName: plan.track.trackName
        }));
        setProxyStatusByTrackId((state) => ({
          ...state,
          [plan.track.trackId]: 'generating'
        }));

        try {
          const generated = await generateTrackProxiesApi({
            plans: [plan],
            bitrateKbps: TRACK_PROXY_BITRATE_KBPS
          });
          results.push(...generated);
          setProxyStatusByTrackId((state) => ({
            ...state,
            [plan.track.trackId]: 'ready'
          }));
        } catch (error) {
          failures.push(`${plan.track.trackName}: ${summarizeProxyError(error)}`);
          setProxyStatusByTrackId((state) => ({
            ...state,
            [plan.track.trackId]: previousStatus
          }));
        } finally {
          setProxyGenerationState((state) => ({
            ...state,
            completed: state.completed + 1,
            failed: failures.length
          }));
        }
      }

      const reusedCount = results.filter((item) => item.reused).length;
      const createdCount = results.length - reusedCount;
      const proxyDir = results[0]?.filePath.replace(/\\[^\\]+$/, '') ?? '';
      const cancelled = proxyGenerationCancelRef.current;
      alert(
        `代理文件处理${cancelled ? '已停止' : '完成'}：新增 ${createdCount} 个，复用 ${reusedCount} 个，失败 ${failures.length} 个。${
          proxyDir ? `\n目录：${proxyDir}` : ''
        }${failures.length > 0 ? `\n失败示例：${failures.slice(0, 3).join('；')}` : ''}`
      );
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      proxyGenerationCancelRef.current = false;
      setProxyGenerationState({
        total: 0,
        completed: 0,
        failed: 0,
        currentTrackName: '',
        cancelRequested: false
      });
      setGeneratingTrackProxies(false);
    }
  };

  const handleSeekPreview = (requestedTimeMs: number) => {
    if (!project) {
      return;
    }
    const playback = usePlaybackStore.getState();

    if (playback.target === 'single') {
      if (!selectedTrack) {
        return;
      }
      const previewPlan = buildSingleTrackPreviewPlan(selectedTrack, project);
      const durationMs =
        playback.mode === 'original'
          ? previewPlan.trimmedSourceDurationMs
          : previewPlan.processedDurationMs;
      const nextPositionMs = Math.max(0, Math.min(durationMs, Math.round(requestedTimeMs)));
      if (playback.isPlaying) {
        if (!playbackStore.seekToPreviewPosition(nextPositionMs)) {
          void playbackStore.playTrack(selectedTrack, project, {
            startPreviewMs: nextPositionMs
          });
        }
        return;
      }
      playbackStore.setPreviewPosition(nextPositionMs, selectedTrack.name, selectedTrack.id);
      return;
    }

    const medleyPlan = buildProjectPreviewExportPlan(project);
    const nextPositionMs = Math.max(0, Math.min(medleyPlan.durationMs, Math.round(requestedTimeMs)));
    const currentClip =
      medleyPlan.clips.find(
        (clip) =>
          nextPositionMs >= clip.timelineStartMs && nextPositionMs < clip.timelineEndMs
      ) ?? medleyPlan.clips.at(-1);
    const clipIndex = currentClip
      ? medleyPlan.clips.findIndex((clip) => clip.track.trackId === currentClip.track.trackId)
      : -1;
    const nextLabel =
      currentClip && clipIndex >= 0
        ? `${clipIndex + 1}. ${currentClip.track.trackName}`
        : '串烧试听';
    const nextTrackId = currentClip?.track.trackId ?? null;

    if (playback.isPlaying) {
      if (!playbackStore.seekToPreviewPosition(nextPositionMs)) {
        void playbackStore.playMedley(project, {
          startPreviewMs: nextPositionMs
        });
      }
      return;
    }
    playbackStore.setPreviewPosition(nextPositionMs, nextLabel, nextTrackId);
  };

  const handleDrop: DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    const dragTypes = Array.from(event.dataTransfer.types ?? []);
    if (dragTypes.includes(WORKSPACE_TRACK_DRAG_MIME)) {
      event.currentTarget.classList.remove('drop-highlight');
      return;
    }
    const files = Array.from(event.dataTransfer.files)
      .map((file) => window.beatStride.getPathForDroppedFile(file))
      .filter((item): item is string => Boolean(item));
    void handleImportFiles(files);
    event.currentTarget.classList.remove('drop-highlight');
  };

  useEffect(() => {
    let cancelled = false;

    const loadProxyStatuses = async () => {
      if (!project) {
        setProxyStatusByTrackId({});
        return;
      }
      if (generatingTrackProxies) {
        return;
      }
      const getTrackProxyStatusesApi = (
        window.beatStride as typeof window.beatStride & {
          getTrackProxyStatuses?: typeof window.beatStride.getTrackProxyStatuses;
        }
      ).getTrackProxyStatuses;
      const projectWorkspaceTracks = getWorkspaceTracks(project.tracks);
      if (typeof getTrackProxyStatusesApi !== 'function') {
        setProxyStatusByTrackId(
          Object.fromEntries(
            projectWorkspaceTracks
              .map((track) => [track.id, 'missing' satisfies TrackProxyStatus])
          )
        );
        return;
      }

      const plans: SingleTrackExportPlan[] = projectWorkspaceTracks
        .map((track) =>
          buildSingleTrackExportPlan(track, {
            globalTargetBpm: project.globalTargetBpm,
            outputDir: '',
            format: 'wav',
            metronomeSamplePath: project.defaultMetronomeSamplePath,
            normalizeLoudness: false,
            projectFilePath: project.meta.filePath,
            mixTuning: project.mixTuning
          })
        );

      if (plans.length === 0) {
        setProxyStatusByTrackId({});
        return;
      }

      try {
        const results = await getTrackProxyStatusesApi({ plans });
        if (cancelled) {
          return;
        }
        setProxyStatusByTrackId(
          Object.fromEntries(results.map((item) => [item.trackId, item.status]))
        );
      } catch {
        if (!cancelled) {
          setProxyStatusByTrackId(
            Object.fromEntries(plans.map((plan) => [plan.track.trackId, 'missing' satisfies TrackProxyStatus]))
          );
        }
      }
    };

    void loadProxyStatuses();
    return () => {
      cancelled = true;
    };
  }, [project, generatingTrackProxies]);

  useEffect(() => {
    if (!resizing) {
      return;
    }
    const handleMove = (event: MouseEvent) => {
      const node = workspaceRef.current;
      if (!node) {
        return;
      }
      const rect = node.getBoundingClientRect();
      const total = rect.width;
      const splitter = 8;
      const minLeft = 240;
      const maxLeft = 560;
      const minRight = 280;
      const maxRight = 560;
      const minCenter = 560;

      if (resizing === 'left') {
        const rawLeft = event.clientX - rect.left;
        const maxByCenter = total - rightWidth - splitter * 2 - minCenter;
        const next = Math.max(minLeft, Math.min(Math.min(maxLeft, maxByCenter), rawLeft));
        setLeftWidth(next);
        return;
      }

      const rawRight = rect.right - event.clientX;
      const maxByCenter = total - leftWidth - splitter * 2 - minCenter;
      const next = Math.max(minRight, Math.min(Math.min(maxRight, maxByCenter), rawRight));
      setRightWidth(next);
    };
    const handleUp = () => setResizing(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [resizing, leftWidth, rightWidth]);

  if (!project) {
    return <div />;
  }

  return (
    <>
      <TitleBar
        projectName={project.meta.name}
        onOpenSettings={onOpenSettings}
        onExport={() => setShowExport(true)}
        onImport={() => void handleImportFiles()}
        onImportFolder={() => void handleImportFolder()}
      />
      <div
        ref={workspaceRef}
        className="workspace"
        style={{
          gridTemplateColumns: `${leftWidth}px 8px minmax(560px, 1fr) 8px ${rightWidth}px`
        }}
        onDragOver={(event) => {
          event.preventDefault();
          const dragTypes = Array.from(event.dataTransfer.types ?? []);
          if (dragTypes.includes(WORKSPACE_TRACK_DRAG_MIME)) {
            event.currentTarget.classList.remove('drop-highlight');
            if (event.dataTransfer) {
              event.dataTransfer.dropEffect = 'move';
            }
            return;
          }
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
          }
          event.currentTarget.classList.add('drop-highlight');
        }}
        onDragLeave={(event) => {
          event.currentTarget.classList.remove('drop-highlight');
        }}
        onDrop={handleDrop}
      >
        <div className="workspace-left">
          <TrackLibraryPanel
            tracks={pendingTracks}
            checkedTrackIds={projectStore.libraryCheckedIds}
            selectedTrackId={selectedTrack?.id}
            onSelectTrack={projectStore.selectTimelineTrack}
            onToggleTrack={projectStore.toggleLibraryCheck}
            onToggleAll={(checked) =>
              projectStore.setLibraryCheckedIds(
                checked ? pendingTracks.map((track) => track.id) : []
              )
            }
            onIncludeCheckedInMedley={() => projectStore.setCheckedMedleyEnabled(true)}
            onRemoveChecked={() =>
              projectStore.removeTracksByIds(
                pendingTracks
                  .filter((track) => projectStore.libraryCheckedIds.includes(track.id))
                  .map((track) => track.id)
              )
            }
          />
        </div>
        <div
          className={`col-splitter ${resizing === 'left' ? 'active' : ''}`}
          onMouseDown={() => setResizing('left')}
        />
        <div className="workspace-center">
          <PreviewPanel
            project={project}
            selectedTrack={selectedTrack}
            checkedTrackIds={projectStore.libraryCheckedIds}
            proxyStatusByTrackId={proxyStatusByTrackId}
            playingTrackId={playbackStore.playingTrackId}
            currentTimeMs={playbackStore.currentTimeMs}
            currentLabel={playbackStore.currentLabel}
            isPlaying={playbackStore.isPlaying}
            volume={playbackStore.volume}
            target={playbackStore.target}
            mode={playbackStore.mode}
            onSelectTarget={playbackStore.setTarget}
            onSelectMode={handleSwitchMode}
            onChangeVolume={playbackStore.setVolume}
            onSeekPreview={handleSeekPreview}
            onSelectTrack={(trackId) => {
              projectStore.selectTimelineTrack(trackId);
              projectStore.setLibraryCheckedIds([trackId]);
            }}
            onToggleTrackCheck={projectStore.toggleLibraryCheck}
            onToggleAllQueueChecked={(checked) =>
              projectStore.setLibraryCheckedIds(
                checked ? workspaceTracks.map((track) => track.id) : []
              )
            }
            onPlaySingle={() => {
              if (selectedTrack && project) {
                void playbackStore.playTrack(selectedTrack, project, {
                  startPreviewMs: playbackStore.currentTimeMs
                });
              }
            }}
            onPlayMedley={() => {
              if (project) {
                void playbackStore.playMedley(project, {
                  startPreviewMs: playbackStore.currentTimeMs
                });
              }
            }}
            onPause={playbackStore.pause}
            onStop={playbackStore.stop}
            onReorderTrack={projectStore.reorderWorkTrack}
            onGenerateTrackProxies={() => void handleGenerateTrackProxies()}
            generatingTrackProxies={generatingTrackProxies}
            proxyGenerationButtonLabel={
              generatingTrackProxies
                ? proxyGenerationState.cancelRequested
                  ? '停止中...'
                  : '停止生成'
                : '生成代理文件'
            }
            proxyGenerationButtonTitle={formatProxyGenerationTitle()}
            onRemoveCheckedFromQueue={() =>
              projectStore.setTracksWorkEnabled(
                workspaceTracks
                  .filter((track) => projectStore.libraryCheckedIds.includes(track.id))
                  .map((track) => track.id),
                false
              )
            }
          />
        </div>
        <div
          className={`col-splitter ${resizing === 'right' ? 'active' : ''}`}
          onMouseDown={() => setResizing('right')}
        />
        <div className="workspace-right">
          <InspectorPanel
            project={project}
            track={selectedTrack}
            onUpdateProject={projectStore.patchProject}
            onUpdateTrack={(trackId, patch) => projectStore.updateTrack(trackId, patch)}
          />
        </div>
      </div>
      {showExport && project && (
        <ExportPanel project={project} selectedTrack={selectedTrack} onClose={() => setShowExport(false)} />
      )}
      <div className="status-chip status-chip-left">
        {importing
          ? '分析 BPM 中'
          : generatingTrackProxies
            ? `生成代理文件 ${proxyGenerationState.completed}/${proxyGenerationState.total}`
            : projectStore.dirty
              ? t('status.processing')
              : t('status.ready')}
      </div>
      <div className="status-chip status-chip-right">
        {exportStore.jobs[0]?.status ?? t('status.ready')}
      </div>
    </>
  );
}

export function App() {
  const settingsStore = useAppSettingsStore();
  const projectStore = useProjectStore();
  const exportStore = useExportStore();
  const [showSettings, setShowSettings] = useState(false);
  const [bootError, setBootError] = useState('');

  useEffect(() => {
    if (!window.beatStride) {
      setBootError('preload api missing: window.beatStride is undefined');
      return () => undefined;
    }
    void settingsStore
      .loadSettings()
      .then(() => settingsStore.checkFfmpeg())
      .catch((error) => setBootError(error instanceof Error ? error.message : String(error)));
    exportStore.setupProgressListener();
    startProjectAutosave();
    return () => stopProjectAutosave();
  }, []);

  useEffect(() => {
    const preventWindowDrop = (event: DragEvent) => {
      event.preventDefault();
    };
    window.addEventListener('dragover', preventWindowDrop);
    window.addEventListener('drop', preventWindowDrop);
    return () => {
      window.removeEventListener('dragover', preventWindowDrop);
      window.removeEventListener('drop', preventWindowDrop);
    };
  }, []);

  useEffect(() => {
    const off = window.beatStride.onMenuAction((action) => {
      if (action === 'project:new') {
        void projectStore.createProject();
        return;
      }
      if (action === 'project:open') {
        void projectStore.openProject();
        return;
      }
      if (action === 'project:save') {
        void projectStore.saveProject();
        return;
      }
      if (action === 'project:saveAs') {
        void projectStore.saveProjectAs();
        return;
      }
      if (action.startsWith('about:')) {
        alert(action.replace('about:', ''));
      }
    });
    return off;
  }, [projectStore.project]);

  const pageMode: PageMode = projectStore.project ? 'editor' : 'welcome';

  return (
    <ThemeProvider
      theme={settingsStore.settings.theme}
      onThemeChange={(theme) => void settingsStore.setTheme(theme)}
    >
      <I18nProvider
        language={settingsStore.settings.language}
        onLanguageChange={(language) => void settingsStore.setLanguage(language)}
      >
        <div className={`app-shell ${pageMode === 'welcome' ? 'welcome-mode' : ''}`}>
          {bootError && <div className="boot-error">{bootError}</div>}
          {pageMode === 'welcome' ? (
            <WelcomePage
              settings={settingsStore.settings}
              onCreateProject={() => void projectStore.createProject()}
              onOpenProject={() => void projectStore.openProject()}
              onRestoreRecovery={() => void projectStore.loadRecovery()}
              onOpenRecent={(path) => void projectStore.openProjectByPath(path)}
            />
          ) : (
            <EditorContent onOpenSettings={() => setShowSettings(true)} />
          )}
          {showSettings && <SettingsPage onClose={() => setShowSettings(false)} />}
        </div>
      </I18nProvider>
    </ThemeProvider>
  );
}
