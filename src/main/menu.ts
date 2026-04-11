import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import type { LanguageCode } from '@shared/types';
import { IPC_CHANNELS } from './ipc/channels';

type MenuAction =
  | 'project:new'
  | 'project:open'
  | 'project:save'
  | 'project:saveAs'
  | 'app:settings';

interface MenuText {
  file: string;
  newProject: string;
  openProject: string;
  save: string;
  saveAs: string;
  settings: string;
  exit: string;
  edit: string;
  undo: string;
  redo: string;
  cut: string;
  copy: string;
  paste: string;
  selectAll: string;
  view: string;
  reload: string;
  forceReload: string;
  toggleDevTools: string;
  resetZoom: string;
  zoomIn: string;
  zoomOut: string;
  toggleFullscreen: string;
  help: string;
  about: string;
}

const MENU_TEXT_MAP: Record<LanguageCode, MenuText> = {
  'zh-CN': {
    file: '文件',
    newProject: '新建项目',
    openProject: '打开项目',
    save: '保存',
    saveAs: '另存为',
    settings: '设置',
    exit: '退出',
    edit: '编辑',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    selectAll: '全选',
    view: '视图',
    reload: '重新加载',
    forceReload: '强制重新加载',
    toggleDevTools: '开发者工具',
    resetZoom: '实际大小',
    zoomIn: '放大',
    zoomOut: '缩小',
    toggleFullscreen: '全屏',
    help: '帮助',
    about: '关于'
  },
  'zh-TW': {
    file: '檔案',
    newProject: '新增專案',
    openProject: '開啟專案',
    save: '儲存',
    saveAs: '另存新檔',
    settings: '設定',
    exit: '離開',
    edit: '編輯',
    undo: '復原',
    redo: '重做',
    cut: '剪下',
    copy: '複製',
    paste: '貼上',
    selectAll: '全選',
    view: '檢視',
    reload: '重新載入',
    forceReload: '強制重新載入',
    toggleDevTools: '開發者工具',
    resetZoom: '實際大小',
    zoomIn: '放大',
    zoomOut: '縮小',
    toggleFullscreen: '全螢幕',
    help: '說明',
    about: '關於'
  },
  'en-US': {
    file: 'File',
    newProject: 'New Project',
    openProject: 'Open Project',
    save: 'Save',
    saveAs: 'Save As',
    settings: 'Settings',
    exit: 'Exit',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    view: 'View',
    reload: 'Reload',
    forceReload: 'Force Reload',
    toggleDevTools: 'Developer Tools',
    resetZoom: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    toggleFullscreen: 'Toggle Fullscreen',
    help: 'Help',
    about: 'About'
  },
  'ja-JP': {
    file: 'ファイル',
    newProject: '新規プロジェクト',
    openProject: 'プロジェクトを開く',
    save: '保存',
    saveAs: '名前を付けて保存',
    settings: '設定',
    exit: '終了',
    edit: '編集',
    undo: '元に戻す',
    redo: 'やり直し',
    cut: '切り取り',
    copy: 'コピー',
    paste: '貼り付け',
    selectAll: 'すべて選択',
    view: '表示',
    reload: '再読み込み',
    forceReload: '強制再読み込み',
    toggleDevTools: '開発者ツール',
    resetZoom: '実際のサイズ',
    zoomIn: '拡大',
    zoomOut: '縮小',
    toggleFullscreen: 'フルスクリーン切替',
    help: 'ヘルプ',
    about: 'バージョン情報'
  },
  'fr-FR': {
    file: 'Fichier',
    newProject: 'Nouveau projet',
    openProject: 'Ouvrir un projet',
    save: 'Enregistrer',
    saveAs: 'Enregistrer sous',
    settings: 'Paramètres',
    exit: 'Quitter',
    edit: 'Édition',
    undo: 'Annuler',
    redo: 'Rétablir',
    cut: 'Couper',
    copy: 'Copier',
    paste: 'Coller',
    selectAll: 'Tout sélectionner',
    view: 'Affichage',
    reload: 'Recharger',
    forceReload: 'Rechargement forcé',
    toggleDevTools: 'Outils de développement',
    resetZoom: 'Taille réelle',
    zoomIn: 'Zoom avant',
    zoomOut: 'Zoom arrière',
    toggleFullscreen: 'Plein écran',
    help: 'Aide',
    about: 'À propos'
  }
};

function sendMenuAction(action: MenuAction): void {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!window || window.isDestroyed()) {
    return;
  }
  window.webContents.send(IPC_CHANNELS.menuAction, action);
}

export function setupAppMenu(language: LanguageCode): void {
  const text = MENU_TEXT_MAP[language] ?? MENU_TEXT_MAP['zh-CN'];

  const template: MenuItemConstructorOptions[] = [
    {
      label: text.file,
      submenu: [
        {
          label: text.newProject,
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuAction('project:new')
        },
        {
          label: text.openProject,
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuAction('project:open')
        },
        { type: 'separator' },
        {
          label: text.save,
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuAction('project:save')
        },
        {
          label: text.saveAs,
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendMenuAction('project:saveAs')
        },
        { type: 'separator' },
        {
          label: text.settings,
          accelerator: 'CmdOrCtrl+,',
          click: () => sendMenuAction('app:settings')
        },
        { type: 'separator' },
        { role: 'quit', label: text.exit }
      ]
    },
    {
      label: text.edit,
      submenu: [
        { role: 'undo', label: text.undo },
        { role: 'redo', label: text.redo },
        { type: 'separator' },
        { role: 'cut', label: text.cut },
        { role: 'copy', label: text.copy },
        { role: 'paste', label: text.paste },
        { role: 'selectAll', label: text.selectAll }
      ]
    },
    {
      label: text.view,
      submenu: [
        { role: 'reload', label: text.reload },
        { role: 'forceReload', label: text.forceReload },
        { role: 'toggleDevTools', label: text.toggleDevTools },
        { type: 'separator' },
        { role: 'resetZoom', label: text.resetZoom },
        { role: 'zoomIn', label: text.zoomIn },
        { role: 'zoomOut', label: text.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: text.toggleFullscreen }
      ]
    },
    {
      label: text.help,
      submenu: [
        {
          label: text.about,
          click: () => {
            const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
            if (window && !window.isDestroyed()) {
              window.webContents.send(
                IPC_CHANNELS.menuAction,
                `about:${app.getName()} ${app.getVersion()}`
              );
            }
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
