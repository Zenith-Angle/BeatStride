import { dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type {
  MedleyExportPlan,
  ProjectFile,
  SingleTrackExportPlan
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
import { exportMedley, exportSingleTrack } from '@main/services/ffmpegService';
import { ExportQueueService } from '@main/services/exportQueueService';
import { setupAppMenu } from '@main/menu';

const settingsService = new SettingsService();
const projectService = new ProjectService();
const exportQueue = new ExportQueueService();

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.appGetSettings, async () => settingsService.load());

  ipcMain.handle(IPC_CHANNELS.appSaveSettings, async (_, partial) => {
    const next = settingsService.patch(partial);
    if (partial?.language) {
      setupAppMenu(next.language);
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
    const dirName = path.basename(dirPath);
    project.meta.name = dirName || project.meta.name;
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
