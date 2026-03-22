import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, shell } from 'electron';

export function createMainWindow(): BrowserWindow {
  const preloadMjsPath = path.join(__dirname, '../preload/index.mjs');
  const preloadJsPath = path.join(__dirname, '../preload/index.js');
  const preloadPath = fs.existsSync(preloadMjsPath) ? preloadMjsPath : preloadJsPath;
  const logoCandidates = [
    path.join(process.cwd(), 'BS_COLOR.png'),
    path.join(process.cwd(), 'build', 'icon.png')
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

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return window;
}
