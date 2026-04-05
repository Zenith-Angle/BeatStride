import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, shell } from 'electron';

export function applyDeveloperTools(window: BrowserWindow, enabled: boolean): void {
  if (enabled) {
    if (!window.webContents.isDevToolsOpened()) {
      window.webContents.openDevTools({ mode: 'detach' });
    }
    return;
  }

  if (window.webContents.isDevToolsOpened()) {
    window.webContents.closeDevTools();
  }
}

export function createMainWindow(options?: {
  isDeveloperModeEnabled?: () => boolean;
}): BrowserWindow {
  const preloadMjsPath = path.join(__dirname, '../preload/index.mjs');
  const preloadJsPath = path.join(__dirname, '../preload/index.js');
  const preloadPath = fs.existsSync(preloadMjsPath) ? preloadMjsPath : preloadJsPath;
  const appPath = app.getAppPath();
  const logoCandidates = [
    path.join(process.cwd(), 'resources', 'logo', 'beatstride-color.png'),
    path.join(process.cwd(), 'resources', 'icon.png'),
    path.join(process.cwd(), 'build', 'icon.png'),
    path.join(appPath, 'resources', 'logo', 'beatstride-color.png'),
    path.join(appPath, 'resources', 'icon.png')
  ];
  const iconPath = logoCandidates.find((item) => fs.existsSync(item));

  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 16 },
    backgroundColor: '#f6f2eb',
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  window.on('ready-to-show', () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: 'deny' };
  });

  window.webContents.on('before-input-event', (event, input) => {
    const devMode = options?.isDeveloperModeEnabled?.() ?? false;
    const togglePressed =
      input.type === 'keyDown' &&
      (input.key === 'F12' ||
        ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i'));

    if (!togglePressed) {
      return;
    }

    if (!devMode) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    if (window.webContents.isDevToolsOpened()) {
      window.webContents.closeDevTools();
    } else {
      window.webContents.openDevTools({ mode: 'detach' });
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  applyDeveloperTools(window, options?.isDeveloperModeEnabled?.() ?? false);

  return window;
}
