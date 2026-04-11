import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { MenuCommandPayload } from '@shared/ipc';
import type {
  MixTuningSettings,
  MedleyExportPlan,
  ProjectFile,
  SingleTrackExportPlan,
  TimeSignature
} from '@shared/types';
import { SUPPORTED_IMPORT_EXT } from '@shared/constants';
import { IPC_CHANNELS } from './channels';
import { SettingsService } from '@main/services/settingsService';
import {
  ProjectService,
  createEmptyProject
} from '@main/services/projectService';
import { detectFfmpegBinaries } from '@main/services/ffmpegBinaryService';
import { probeAudioMetadata } from '@main/services/ffprobeService';
import { TrackAnalysisService } from '@main/services/trackAnalysisService';
import { preparePlaybackPayload } from '@main/services/playbackProxyService';
import { getAudioWaveform } from '@main/services/waveformService';
import {
  exportMedley,
  exportSingleTrack,
  generateTrackProxies,
  getTrackProxyStatuses,
  renderMedleyPreviewPayload,
  renderSinglePreviewPayload
} from '@main/services/ffmpegService';
import { ExportQueueService } from '@main/services/exportQueueService';
import { setupAppMenu } from '@main/menu';
import { applyDeveloperTools } from '@main/window';

const settingsService = new SettingsService();
const projectService = new ProjectService();
const exportQueue = new ExportQueueService();
const trackAnalysisService = new TrackAnalysisService();

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.appGetSettings, async () => settingsService.load());

  ipcMain.handle(IPC_CHANNELS.appSaveSettings, async (_, partial) => {
    const next = settingsService.patch(partial);
    if (partial?.language) {
      setupAppMenu(next.language);
    }
    if (typeof partial?.developerMode === 'boolean') {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          applyDeveloperTools(window, partial.developerMode as boolean);
        }
      });
    }
    return next;
  });

  ipcMain.handle(IPC_CHANNELS.appCheckFfmpeg, async (_, overrides) => {
    const detected = detectFfmpegBinaries(overrides);
    settingsService.patch({ ffmpeg: detected });
    return detected;
  });

  ipcMain.handle(IPC_CHANNELS.appOpenExternal, async (_, targetPath: string) => {
    if (!targetPath) {
      return false;
    }
    await shell.openPath(targetPath);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.menuExecute, async (_, command: MenuCommandPayload) => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

    if (command === 'app:quit') {
      app.quit();
      return true;
    }

    if (!window || window.isDestroyed()) {
      return false;
    }

    const { webContents } = window;

    switch (command) {
      case 'edit:undo':
        webContents.undo();
        return true;
      case 'edit:redo':
        webContents.redo();
        return true;
      case 'edit:cut':
        webContents.cut();
        return true;
      case 'edit:copy':
        webContents.copy();
        return true;
      case 'edit:paste':
        webContents.paste();
        return true;
      case 'edit:selectAll':
        webContents.selectAll();
        return true;
      case 'view:reload':
        webContents.reload();
        return true;
      case 'view:forceReload':
        webContents.reloadIgnoringCache();
        return true;
      case 'view:toggleDevTools':
        if (webContents.isDevToolsOpened()) {
          webContents.closeDevTools();
        } else {
          webContents.openDevTools({ mode: 'detach' });
        }
        return true;
      case 'view:resetZoom':
        webContents.setZoomLevel(0);
        return true;
      case 'view:zoomIn':
        webContents.setZoomLevel(Math.min(3, webContents.getZoomLevel() + 0.5));
        return true;
      case 'view:zoomOut':
        webContents.setZoomLevel(Math.max(-3, webContents.getZoomLevel() - 0.5));
        return true;
      case 'view:toggleFullscreen':
        window.setFullScreen(!window.isFullScreen());
        return true;
      case 'help:about':
        webContents.send(IPC_CHANNELS.menuAction, `about:${app.getName()} ${app.getVersion()}`);
        return true;
      default:
        return false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.dialogSelectAudioFiles, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Audio Files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Audio',
          extensions: SUPPORTED_IMPORT_EXT.map((ext) => ext.replace('.', ''))
        }
      ]
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle(IPC_CHANNELS.dialogSelectAudioFolder, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Audio Folder',
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    const rootDir = result.filePaths[0]!;
    const matched: string[] = [];
    const extSet = new Set(SUPPORTED_IMPORT_EXT.map((ext) => ext.toLowerCase()));

    const walk = (dirPath: string): void => {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (extSet.has(ext)) {
          matched.push(fullPath);
        }
      }
    };

    walk(rootDir);
    return matched;
  });

  ipcMain.handle(IPC_CHANNELS.dialogSelectExportDir, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Export Directory',
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? '' : result.filePaths[0] ?? '';
  });

  ipcMain.handle(IPC_CHANNELS.dialogSelectFfmpegPath, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select FFmpeg Binary',
      properties: ['openFile'],
      filters: [
        { name: 'Executable', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }
      ]
    });
    return result.canceled ? '' : result.filePaths[0] ?? '';
  });

  ipcMain.handle(IPC_CHANNELS.dialogSelectFfprobePath, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select FFprobe Binary',
      properties: ['openFile'],
      filters: [
        { name: 'Executable', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }
      ]
    });
    return result.canceled ? '' : result.filePaths[0] ?? '';
  });

  ipcMain.handle(IPC_CHANNELS.dialogSelectMetronomeSample, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Metronome Sample',
      properties: ['openFile'],
      filters: [
        {
          name: 'Audio',
          extensions: SUPPORTED_IMPORT_EXT.map((ext) => ext.replace('.', ''))
        }
      ]
    });
    return result.canceled ? '' : result.filePaths[0] ?? '';
  });

  ipcMain.handle(IPC_CHANNELS.projectNew, async () => {
    const dirPath = projectService.selectProjectDirectory();
    if (!dirPath) {
      return null;
    }
    const project = createEmptyProject();
    const settings = settingsService.load();
    const dirName = path.basename(dirPath);
    project.meta.name = dirName || project.meta.name;
    project.globalTargetBpm = settings.defaultTargetBpm || project.globalTargetBpm;
    project.mixTuning.loudnormEnabled =
      settings.normalizeLoudnessByDefault ?? project.mixTuning.loudnormEnabled;
    project.exportPreset.outputDir =
      dirPath || settings.defaultExportDir || project.exportPreset.outputDir;
    if (settings.defaultMetronomeSamplePath) {
      project.defaultMetronomeSamplePath = settings.defaultMetronomeSamplePath;
    }
    const filePath = projectService.generateProjectFilePath(
      dirPath,
      dirName || 'beatstride-project'
    );
    const saved = projectService.writeProject(filePath, project);
    settingsService.appendRecentProject(filePath);
    return saved;
  });

  ipcMain.handle(IPC_CHANNELS.projectOpen, async () => {
    const filePath = projectService.openProjectFileDialog();
    if (!filePath) {
      return null;
    }
    const project = projectService.readProject(filePath);
    settingsService.appendRecentProject(filePath);
    return project;
  });

  ipcMain.handle(IPC_CHANNELS.projectOpenByPath, async (_, filePath: string) => {
    if (!filePath) {
      return null;
    }
    const project = projectService.readProject(filePath);
    settingsService.appendRecentProject(filePath);
    return project;
  });

  ipcMain.handle(
    IPC_CHANNELS.projectSave,
    async (_, payload: { project: ProjectFile; filePath?: string }) => {
      const targetPath =
        payload.filePath ??
        payload.project.meta.filePath ??
        projectService.saveProjectFileDialog();
      if (!targetPath) {
        return null;
      }
      const saved = projectService.writeProject(targetPath, payload.project);
      settingsService.appendRecentProject(targetPath);
      return saved;
    }
  );

  ipcMain.handle(IPC_CHANNELS.projectSaveAs, async (_, payload: { project: ProjectFile }) => {
    const filePath = projectService.saveProjectFileDialog(payload.project.meta.filePath);
    if (!filePath) {
      return null;
    }
    const saved = projectService.writeProject(filePath, payload.project);
    settingsService.appendRecentProject(filePath);
    return saved;
  });

  ipcMain.handle(IPC_CHANNELS.projectSaveRecovery, async (_, payload: ProjectFile) => {
    projectService.saveRecovery(payload);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.projectLoadRecovery, async () => projectService.loadRecovery());

  ipcMain.handle(IPC_CHANNELS.audioProbe, async (_, filePath: string) => {
    const settings = settingsService.load();
    if (!settings.ffmpeg.available || !settings.ffmpeg.ffprobePath) {
      throw new Error('ffprobe not available');
    }
    return probeAudioMetadata(settings.ffmpeg.ffprobePath, filePath);
  });

  ipcMain.handle(
    IPC_CHANNELS.audioAnalyzeTracks,
    async (_, payload: { tracks: Array<{ filePath: string }>; analysisSeconds: number }) => {
      const settings = settingsService.load();
      return trackAnalysisService.analyzeTracks(payload, settings.ffmpeg.ffmpegPath);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.audioSuggestTrackAlignments,
    async (
      _,
      payload: {
        tracks: Array<{
          filePath: string;
          bpm: number;
          targetBpm?: number;
          downbeatOffsetMs: number;
          beatsPerBar: number;
          timeSignature: TimeSignature;
        }>;
        globalTargetBpm: number;
        mixTuning: Pick<
          MixTuningSettings,
          'harmonicTolerance' | 'harmonicMappingEnabled' | 'halfMapUpperBpm'
        >;
      }
    ) => {
      return trackAnalysisService.suggestTrackAlignments(payload);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.audioGetWaveform,
    async (_, payload: {
      filePath: string;
      durationMs: number;
      trimInMs?: number;
      trimOutMs?: number;
      points?: number;
    }) => {
      const settings = settingsService.load();
      if (!settings.ffmpeg.available || !settings.ffmpeg.ffmpegPath) {
        throw new Error('ffmpeg not available');
      }
      return getAudioWaveform(settings.ffmpeg.ffmpegPath, payload);
    }
  );

  ipcMain.handle(IPC_CHANNELS.audioPreparePlayback, async (_, filePath: string) => {
    const settings = settingsService.load();
    if (!settings.ffmpeg.available || !settings.ffmpeg.ffmpegPath) {
      throw new Error('ffmpeg not available');
    }
    return preparePlaybackPayload(settings.ffmpeg.ffmpegPath, filePath);
  });

  ipcMain.handle(
    IPC_CHANNELS.audioPrepareSinglePreview,
    async (_, payload: { plan: SingleTrackExportPlan; mode: 'original' | 'processed' | 'metronome' }) => {
      const settings = settingsService.load();
      if (!settings.ffmpeg.available || !settings.ffmpeg.ffmpegPath) {
        throw new Error('ffmpeg not available');
      }
      return renderSinglePreviewPayload(settings.ffmpeg.ffmpegPath, payload.plan, payload.mode);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.audioPrepareMedleyPreview,
    async (_, payload: { plan: MedleyExportPlan; mode: 'processed' | 'metronome' }) => {
      const settings = settingsService.load();
      if (!settings.ffmpeg.available || !settings.ffmpeg.ffmpegPath) {
        throw new Error('ffmpeg not available');
      }
      return renderMedleyPreviewPayload(settings.ffmpeg.ffmpegPath, payload.plan, payload.mode);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.audioGenerateTrackProxies,
    async (_, payload: { plans: SingleTrackExportPlan[]; bitrateKbps?: number }) => {
      const settings = settingsService.load();
      if (!settings.ffmpeg.available || !settings.ffmpeg.ffmpegPath) {
        throw new Error('ffmpeg not available');
      }
      return generateTrackProxies(
        settings.ffmpeg.ffmpegPath,
        payload.plans,
        { bitrateKbps: payload.bitrateKbps }
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.audioGetTrackProxyStatuses,
    async (_, payload: { plans: SingleTrackExportPlan[] }) => getTrackProxyStatuses(payload.plans)
  );

  ipcMain.handle(
    IPC_CHANNELS.exportSingle,
    async (_, payload: { id: string; plan: SingleTrackExportPlan; bitrateKbps?: number }) => {
      const settings = settingsService.load();
      if (!settings.ffmpeg.available) {
        throw new Error('ffmpeg not available');
      }
      return exportQueue.runJob(payload.id, 'single', async () =>
        exportSingleTrack(settings.ffmpeg.ffmpegPath, payload.plan, {
          bitrateKbps: payload.bitrateKbps,
          onProgress: (progress) => {
            void _.sender.send(IPC_CHANNELS.exportProgress, {
              id: payload.id,
              mode: 'single',
              progress: progress.ratio,
              timeMs: progress.timeMs
            });
          }
        })
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.exportMedley,
    async (_, payload: { id: string; plan: MedleyExportPlan; bitrateKbps?: number }) => {
      const settings = settingsService.load();
      if (!settings.ffmpeg.available) {
        throw new Error('ffmpeg not available');
      }
      return exportQueue.runJob(payload.id, 'medley', async () =>
        exportMedley(settings.ffmpeg.ffmpegPath, payload.plan, {
          bitrateKbps: payload.bitrateKbps,
          onProgress: (progress) => {
            void _.sender.send(IPC_CHANNELS.exportProgress, {
              id: payload.id,
              mode: 'medley',
              progress: progress.ratio,
              timeMs: progress.timeMs
            });
          }
        })
      );
    }
  );
}
