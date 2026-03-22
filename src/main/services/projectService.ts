import fs from 'node:fs';
import path from 'node:path';
import { app, dialog } from 'electron';
import {
  DEFAULT_EXPORT_PRESET,
  DEFAULT_LANGUAGE,
  DEFAULT_THEME,
  DEFAULT_TIME_SIGNATURE,
  PROJECT_FILE_EXT,
  PROJECT_VERSION
} from '@shared/constants';
import type { ProjectFile } from '@shared/types';

const RECOVERY_FILE = 'project.recovery.json';

export function createEmptyProject(): ProjectFile {
  const now = new Date().toISOString();
  const defaultMetronomeSamplePath = path.join(
    app.getAppPath(),
    'resources',
    'metronome',
    '180BPM.mp3'
  );
  const metronomePath = fs.existsSync(defaultMetronomeSamplePath)
    ? defaultMetronomeSamplePath
    : '';

  return {
    version: PROJECT_VERSION,
    meta: {
      id: crypto.randomUUID(),
      name: 'Untitled Project',
      createdAt: now,
      updatedAt: now
    },
    globalTargetBpm: 180,
    timeSignature: DEFAULT_TIME_SIGNATURE,
    defaultMetronomeSamplePath: metronomePath,
    theme: DEFAULT_THEME,
    language: DEFAULT_LANGUAGE,
    tracks: [],
    exportPreset: {
      ...DEFAULT_EXPORT_PRESET
    }
  };
}

export class ProjectService {
  selectProjectDirectory(): string | null {
    const result = dialog.showOpenDialogSync({
      title: 'Select Project Directory',
      properties: ['openDirectory', 'createDirectory']
    });
    if (!result || result.length === 0) {
      return null;
    }
    return result[0] ?? null;
  }

  generateProjectFilePath(dirPath: string, baseName = 'beatstride-project'): string {
    const normalizedBase = baseName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim() || 'beatstride-project';
    const extension = PROJECT_FILE_EXT;
    let candidate = path.join(dirPath, `${normalizedBase}${extension}`);
    let index = 1;
    while (fs.existsSync(candidate)) {
      candidate = path.join(dirPath, `${normalizedBase}-${index}${extension}`);
      index += 1;
    }
    return candidate;
  }

  openProjectFileDialog(): string | null {
    const result = dialog.showOpenDialogSync({
      title: 'Open Project',
      filters: [{ name: 'BeatStride Project', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (!result || result.length === 0) {
      return null;
    }
    return result[0] ?? null;
  }

  saveProjectFileDialog(defaultPath?: string): string | null {
    const result = dialog.showSaveDialogSync({
      title: 'Save Project',
      defaultPath:
        defaultPath ??
        path.join(app.getPath('documents'), `beatstride-project${PROJECT_FILE_EXT}`),
      filters: [{ name: 'BeatStride Project', extensions: ['json'] }]
    });
    return result ?? null;
  }

  readProject(filePath: string): ProjectFile {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as ProjectFile;
    parsed.meta.filePath = filePath;
    return parsed;
  }

  writeProject(filePath: string, project: ProjectFile): ProjectFile {
    const next: ProjectFile = {
      ...project,
      meta: {
        ...project.meta,
        filePath,
        updatedAt: new Date().toISOString()
      }
    };
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf-8');
    return next;
  }

  getRecoveryPath(): string {
    return path.join(app.getPath('userData'), RECOVERY_FILE);
  }

  saveRecovery(project: ProjectFile): void {
    const filePath = this.getRecoveryPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8');
  }

  loadRecovery(): ProjectFile | null {
    const filePath = this.getRecoveryPath();
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as ProjectFile;
  }
}
