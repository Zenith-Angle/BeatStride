import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, protocol } from 'electron';
import { MEDIA_PROTOCOL_SCHEME } from '@shared/constants';
import { registerIpcHandlers } from './ipc';
import { createMainWindow } from './window';
import { detectFfmpegBinaries } from './services/ffmpegBinaryService';
import { registerMediaProtocol } from './services/mediaProtocolService';
import { SettingsService } from './services/settingsService';
import { setupAppMenu } from './menu';

const settingsService = new SettingsService();

protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

function bootstrap(): void {
  registerMediaProtocol();
  registerIpcHandlers();
  const saved = settingsService.load();
  const detected = detectFfmpegBinaries({
    ffmpegPath: saved.ffmpeg.ffmpegPath,
    ffprobePath: saved.ffmpeg.ffprobePath
  });
  const defaultMetronomeSamplePath = path.join(
    app.getAppPath(),
    'resources',
    'metronome',
    '180BPM.mp3'
  );
  const nextMetronomePath =
    saved.defaultMetronomeSamplePath ||
    (fs.existsSync(defaultMetronomeSamplePath) ? defaultMetronomeSamplePath : '');

  settingsService.patch({
    ffmpeg: detected,
    defaultMetronomeSamplePath: nextMetronomePath
  });
  setupAppMenu(saved.language);
  createMainWindow({
    isDeveloperModeEnabled: () => settingsService.load().developerMode
  });
}

app.whenReady().then(() => {
  bootstrap();

  app.on('activate', () => {
    if (app.isReady() && BrowserWindow.getAllWindows().length === 0) {
      createMainWindow({
        isDeveloperModeEnabled: () => settingsService.load().developerMode
      });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
