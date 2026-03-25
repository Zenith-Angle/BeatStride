import { useEffect, useRef, useState, type DragEventHandler } from 'react';
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

function EditorContent({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useI18n();
  const projectStore = useProjectStore();
  const playbackStore = usePlaybackStore();
  const exportStore = useExportStore();
  const [showExport, setShowExport] = useState(false);
  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(360);
  const [resizing, setResizing] = useState<null | 'left' | 'right'>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  const project = projectStore.project;
  const tracks = project?.tracks ?? [];
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
    const probed = await Promise.all(
      paths.map(async (filePath) => ({
        filePath,
        probe: await window.beatStride.probeAudio(filePath)
      }))
    );
    projectStore.addTracksFromFiles(probed);
  };

  const handleDrop: DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files)
      .map((file) => window.beatStride.getPathForDroppedFile(file))
      .filter((item): item is string => Boolean(item));
    void handleImportFiles(files);
    event.currentTarget.classList.remove('drop-highlight');
  };

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
        onImportFolder={() => void projectStore.addTracksFromFolder()}
      />
      <div
        ref={workspaceRef}
        className="workspace"
        style={{
          gridTemplateColumns: `${leftWidth}px 8px minmax(560px, 1fr) 8px ${rightWidth}px`
        }}
        onDragOver={(event) => {
          event.preventDefault();
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
            playingTrackId={playbackStore.playingTrackId}
            currentTimeMs={playbackStore.currentTimeMs}
            currentLabel={playbackStore.currentLabel}
            isPlaying={playbackStore.isPlaying}
            target={playbackStore.target}
            mode={playbackStore.mode}
            onSelectTarget={playbackStore.setTarget}
            onSelectMode={playbackStore.setMode}
            onSelectTrack={projectStore.selectTimelineTrack}
            onToggleTrackCheck={projectStore.toggleLibraryCheck}
            onToggleAllQueueChecked={(checked) =>
              projectStore.setLibraryCheckedIds(
                checked ? tracks.filter((track) => track.exportEnabled).map((track) => track.id) : []
              )
            }
            onPlaySingle={() => {
              if (selectedTrack && project) {
                void playbackStore.playTrack(selectedTrack, project);
              }
            }}
            onPlayMedley={() => {
              if (project) {
                void playbackStore.playMedley(project);
              }
            }}
            onStop={playbackStore.stop}
            onMoveSelectedTrack={(direction) => {
              if (selectedTrack) {
                projectStore.moveTrack(selectedTrack.id, direction);
              }
            }}
            onRemoveCheckedFromQueue={() =>
              projectStore.setTracksWorkEnabled(
                tracks.filter(
                  (track) =>
                    track.exportEnabled &&
                    projectStore.libraryCheckedIds.includes(track.id)
                ).map((track) => track.id),
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
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          left: 14,
          color: 'var(--text-subtle)',
          fontSize: 12
        }}
      >
        {projectStore.dirty ? t('status.processing') : t('status.ready')}
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          right: 14,
          color: 'var(--text-subtle)',
          fontSize: 12
        }}
      >
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
          {bootError && (
            <div
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                zIndex: 99,
                maxWidth: 460,
                border: '1px solid var(--danger)',
                borderRadius: 10,
                background: 'var(--bg-elevated)',
                color: 'var(--danger)',
                padding: '8px 10px'
              }}
            >
              {bootError}
            </div>
          )}
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
