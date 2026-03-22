import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { BeatStrideApi } from '@shared/ipc';
import { IPC_CHANNELS } from '../main/ipc/channels';

const api: BeatStrideApi = {
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.appGetSettings),
  saveSettings: (partial) => ipcRenderer.invoke(IPC_CHANNELS.appSaveSettings, partial),
  checkFfmpeg: (overrides) => ipcRenderer.invoke(IPC_CHANNELS.appCheckFfmpeg, overrides),
  selectAudioFiles: () => ipcRenderer.invoke(IPC_CHANNELS.dialogSelectAudioFiles),
  selectAudioFolder: () => ipcRenderer.invoke(IPC_CHANNELS.dialogSelectAudioFolder),
  selectExportDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.dialogSelectExportDir),
  createNewProject: () => ipcRenderer.invoke(IPC_CHANNELS.projectNew),
  openProject: () => ipcRenderer.invoke(IPC_CHANNELS.projectOpen),
  openProjectByPath: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.projectOpenByPath, filePath),
  saveProject: (payload) => ipcRenderer.invoke(IPC_CHANNELS.projectSave, payload),
  saveProjectAs: (payload) => ipcRenderer.invoke(IPC_CHANNELS.projectSaveAs, payload),
  saveRecovery: (project) => ipcRenderer.invoke(IPC_CHANNELS.projectSaveRecovery, project),
  loadRecovery: () => ipcRenderer.invoke(IPC_CHANNELS.projectLoadRecovery),
  probeAudio: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.audioProbe, filePath),
  runSingleExport: (payload) => ipcRenderer.invoke(IPC_CHANNELS.exportSingle, payload),
  runMedleyExport: (payload) => ipcRenderer.invoke(IPC_CHANNELS.exportMedley, payload),
  onExportProgress: (listener) => {
    const wrapped = (_: unknown, payload: Parameters<typeof listener>[0]) => {
      listener(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.exportProgress, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.exportProgress, wrapped);
  },
  onMenuAction: (listener) => {
    const wrapped = (_: unknown, payload: Parameters<typeof listener>[0]) => {
      listener(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.menuAction, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.menuAction, wrapped);
  },
  openPath: (targetPath) => ipcRenderer.invoke(IPC_CHANNELS.appOpenExternal, targetPath),
  getPathForDroppedFile: (file) => webUtils.getPathForFile(file)
};

contextBridge.exposeInMainWorld('beatStride', api);
