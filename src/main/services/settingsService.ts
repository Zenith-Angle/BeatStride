import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { AppSettings } from '@shared/types';

const SETTINGS_FILE = 'settings.json';

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export class SettingsService {
  private settingsPath: string;
  private cache: AppSettings | null = null;

  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);
  }

  load(): AppSettings {
    if (this.cache) {
      return this.cache;
    }
    if (!fs.existsSync(this.settingsPath)) {
      this.cache = { ...DEFAULT_SETTINGS };
      return this.cache;
    }
    const content = fs.readFileSync(this.settingsPath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<AppSettings>;
    this.cache = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      ffmpeg: {
        ...DEFAULT_SETTINGS.ffmpeg,
        ...(parsed.ffmpeg ?? {})
      },
      recentProjectPaths:
        parsed.recentProjectPaths ?? DEFAULT_SETTINGS.recentProjectPaths
    };
    return this.cache;
  }

  save(next: AppSettings): AppSettings {
    this.cache = next;
    ensureDir(this.settingsPath);
    fs.writeFileSync(this.settingsPath, JSON.stringify(next, null, 2), 'utf-8');
    return next;
  }

  patch(next: Partial<AppSettings>): AppSettings {
    const merged: AppSettings = {
      ...this.load(),
      ...next,
      ffmpeg: {
        ...this.load().ffmpeg,
        ...(next.ffmpeg ?? {})
      },
      recentProjectPaths: next.recentProjectPaths ?? this.load().recentProjectPaths
    };
    return this.save(merged);
  }

  appendRecentProject(filePath: string): AppSettings {
    const current = this.load();
    const dedup = [filePath, ...current.recentProjectPaths.filter((item) => item !== filePath)];
    return this.patch({ recentProjectPaths: dedup.slice(0, 12) });
  }
}
