import { useEffect, useState } from 'react';
import { LANGUAGE_OPTIONS } from '@renderer/features/i18n/messages';
import { useI18n } from '@renderer/features/i18n/I18nProvider';
import { useTheme } from '@renderer/features/theme/ThemeProvider';
import { useAppSettingsStore } from '@renderer/stores/appSettingsStore';

interface SettingsPageProps {
  onClose: () => void;
}

type SettingsFrame = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type InteractionState =
  | {
      type: 'drag';
      startX: number;
      startY: number;
      frame: SettingsFrame;
    }
  | {
      type: 'resize';
      startX: number;
      startY: number;
      frame: SettingsFrame;
    }
  | null;

const MIN_WIDTH = 620;
const MIN_HEIGHT = 420;
const VIEWPORT_MARGIN = 16;

interface PathFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBrowse: () => void | Promise<void>;
}

function getInitialFrame(): SettingsFrame {
  if (typeof window === 'undefined') {
    return { top: 72, left: 96, width: 760, height: 520 };
  }

  const width = Math.min(760, window.innerWidth - VIEWPORT_MARGIN * 2);
  const height = Math.min(520, window.innerHeight - VIEWPORT_MARGIN * 2);
  return {
    width,
    height,
    left: Math.max(VIEWPORT_MARGIN, Math.round((window.innerWidth - width) / 2)),
    top: Math.max(56, Math.round((window.innerHeight - height) / 2))
  };
}

function clampFrame(frame: SettingsFrame): SettingsFrame {
  const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
  const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - VIEWPORT_MARGIN * 2);
  const width = Math.min(Math.max(MIN_WIDTH, frame.width), maxWidth);
  const height = Math.min(Math.max(MIN_HEIGHT, frame.height), maxHeight);
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, frame.left),
    Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)
  );
  const top = Math.min(
    Math.max(56, frame.top),
    Math.max(56, window.innerHeight - height - VIEWPORT_MARGIN)
  );

  return { top, left, width, height };
}

function PathField({ label, value, onChange, onBrowse }: PathFieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="path-field-row">
        <input value={value} onChange={(event) => onChange(event.target.value)} />
        <button type="button" className="wire-btn browse-btn" onClick={() => void onBrowse()}>
          浏览
        </button>
      </div>
    </label>
  );
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const { t, language, setLanguage } = useI18n();
  const { theme, setTheme } = useTheme();
  const settingsStore = useAppSettingsStore();
  const settings = settingsStore.settings;
  const [frame, setFrame] = useState<SettingsFrame>(() => getInitialFrame());
  const [interaction, setInteraction] = useState<InteractionState>(null);

  useEffect(() => {
    const handleResize = () => {
      setFrame((current) => clampFrame(current));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!interaction) {
      return;
    }

    const handleMove = (event: MouseEvent) => {
      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;

      if (interaction.type === 'drag') {
        setFrame(
          clampFrame({
            ...interaction.frame,
            left: interaction.frame.left + deltaX,
            top: interaction.frame.top + deltaY
          })
        );
        return;
      }

      setFrame(
        clampFrame({
          ...interaction.frame,
          width: interaction.frame.width + deltaX,
          height: interaction.frame.height + deltaY
        })
      );
    };

    const handleUp = () => setInteraction(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [interaction]);

  return (
    <div className="settings-overlay no-drag">
      <section
        className="settings-window panel"
        style={{
          top: frame.top,
          left: frame.left,
          width: frame.width,
          height: frame.height
        }}
      >
        <div
          className="panel-header settings-header"
          onMouseDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            setInteraction({
              type: 'drag',
              startX: event.clientX,
              startY: event.clientY,
              frame
            });
          }}
        >
          <strong>{t('settings.title')}</strong>
          <div className="settings-header-actions">
            <span className="muted settings-drag-hint">可拖动 / 可拉伸</span>
            <button onClick={onClose}>{t('common.close')}</button>
          </div>
        </div>
        <div className="panel-content">
          <div className="settings-grid">
            <label className="field">
              <span>{t('common.language')}</span>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as typeof language)}
              >
                {LANGUAGE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('common.theme')}</span>
              <select value={theme} onChange={(event) => setTheme(event.target.value as typeof theme)}>
                <option value="system">{t('common.system')}</option>
                <option value="light">{t('common.light')}</option>
                <option value="dark">{t('common.dark')}</option>
              </select>
            </label>
            <PathField
              label={t('settings.defaultExportDir')}
              value={settings.defaultExportDir}
              onChange={(value) => void settingsStore.patchSettings({ defaultExportDir: value })}
              onBrowse={async () => {
                const next = await window.beatStride.selectExportDirectory();
                if (!next) {
                  return;
                }
                await settingsStore.patchSettings({ defaultExportDir: next });
              }}
            />
            <PathField
              label={t('settings.ffmpegPath')}
              value={settings.ffmpeg.ffmpegPath}
              onChange={(value) =>
                void settingsStore.patchSettings({
                  ffmpeg: { ...settings.ffmpeg, ffmpegPath: value }
                })
              }
              onBrowse={async () => {
                const next = await window.beatStride.selectFfmpegPath();
                if (!next) {
                  return;
                }
                await settingsStore.patchSettings({
                  ffmpeg: { ...settings.ffmpeg, ffmpegPath: next }
                });
              }}
            />
            <PathField
              label={t('settings.ffprobePath')}
              value={settings.ffmpeg.ffprobePath}
              onChange={(value) =>
                void settingsStore.patchSettings({
                  ffmpeg: { ...settings.ffmpeg, ffprobePath: value }
                })
              }
              onBrowse={async () => {
                const next = await window.beatStride.selectFfprobePath();
                if (!next) {
                  return;
                }
                await settingsStore.patchSettings({
                  ffmpeg: { ...settings.ffmpeg, ffprobePath: next }
                });
              }}
            />
            <PathField
              label={t('settings.defaultMetronomeSample')}
              value={settings.defaultMetronomeSamplePath}
              onChange={(value) =>
                void settingsStore.patchSettings({
                  defaultMetronomeSamplePath: value
                })
              }
              onBrowse={async () => {
                const next = await window.beatStride.selectMetronomeSamplePath();
                if (!next) {
                  return;
                }
                await settingsStore.patchSettings({
                  defaultMetronomeSamplePath: next
                });
              }}
            />
            <label className="field">
              <span>{t('settings.defaultTargetBpm')}</span>
              <input
                type="number"
                value={settings.defaultTargetBpm}
                onChange={(event) =>
                  void settingsStore.patchSettings({ defaultTargetBpm: Number(event.target.value) })
                }
              />
            </label>
            <label className="field">
              <span>{t('settings.defaultFade')}</span>
              <input
                type="number"
                value={settings.defaultFadeMs}
                onChange={(event) =>
                  void settingsStore.patchSettings({ defaultFadeMs: Number(event.target.value) })
                }
              />
            </label>
            <label className="field">
              <span>开发者模式</span>
              <div className="path-field-row">
                <div className="muted settings-developer-hint">
                  开启后允许使用 F12 / Ctrl+Shift+I，并自动打开浏览器开发者工具。
                </div>
                <input
                  type="checkbox"
                  className="settings-developer-toggle"
                  checked={settings.developerMode}
                  onChange={(event) =>
                    void settingsStore.patchSettings({ developerMode: event.target.checked })
                  }
                />
              </div>
            </label>
          </div>
        </div>
        <div
          className={`settings-resize-handle ${interaction?.type === 'resize' ? 'active' : ''}`}
          onMouseDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            event.stopPropagation();
            setInteraction({
              type: 'resize',
              startX: event.clientX,
              startY: event.clientY,
              frame
            });
          }}
        />
      </section>
    </div>
  );
}
