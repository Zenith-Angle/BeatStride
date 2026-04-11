import { useEffect, useMemo, useState } from 'react';
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

type SettingsSection = 'general' | 'training' | 'ffmpeg' | 'advanced';

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

const MIN_WIDTH = 860;
const MIN_HEIGHT = 560;
const VIEWPORT_MARGIN = 16;

interface PathFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBrowse: () => void | Promise<void>;
}

function getInitialFrame(): SettingsFrame {
  if (typeof window === 'undefined') {
    return { top: 72, left: 96, width: 980, height: 640 };
  }

  const width = Math.min(980, window.innerWidth - VIEWPORT_MARGIN * 2);
  const height = Math.min(640, window.innerHeight - VIEWPORT_MARGIN * 2);
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
  const { t } = useI18n();
  return (
    <label className="field settings-field">
      <span>{label}</span>
      <div className="path-field-row">
        <input value={value} onChange={(event) => onChange(event.target.value)} />
        <button type="button" className="wire-btn browse-btn" onClick={() => void onBrowse()}>
          {t('common.browse')}
        </button>
      </div>
    </label>
  );
}

function formatCheckedAt(value: string, locale: string, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(parsed);
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const { t, language, setLanguage } = useI18n();
  const { theme, setTheme } = useTheme();
  const settingsStore = useAppSettingsStore();
  const settings = settingsStore.settings;
  const [frame, setFrame] = useState<SettingsFrame>(() => getInitialFrame());
  const [interaction, setInteraction] = useState<InteractionState>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [detectingFfmpeg, setDetectingFfmpeg] = useState(false);

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

  const navItems = useMemo(
    () => [
      { key: 'general' as const, label: t('settings.sectionGeneral'), hint: t('settings.sectionGeneralHint') },
      {
        key: 'training' as const,
        label: t('settings.sectionTraining'),
        hint: t('settings.sectionTrainingHint')
      },
      { key: 'ffmpeg' as const, label: t('settings.sectionFfmpeg'), hint: t('settings.sectionFfmpegHint') },
      { key: 'advanced' as const, label: t('settings.sectionAdvanced'), hint: t('settings.sectionAdvancedHint') }
    ],
    [t]
  );

  const sectionMeta = useMemo(
    () => ({
      general: {
        title: t('settings.sectionGeneral'),
        description: t('settings.sectionGeneralDescription')
      },
      training: {
        title: t('settings.sectionTraining'),
        description: t('settings.sectionTrainingDescription')
      },
      ffmpeg: {
        title: t('settings.sectionFfmpeg'),
        description: t('settings.sectionFfmpegDescription')
      },
      advanced: {
        title: t('settings.sectionAdvanced'),
        description: t('settings.sectionAdvancedDescription')
      }
    }),
    [t]
  );

  const ffmpegStatusLabel = settings.ffmpeg.available
    ? t('settings.ffmpegAvailable')
    : t('settings.ffmpegMissing');
  const ffmpegStatusTone = settings.ffmpeg.available ? 'available' : 'missing';
  const ffmpegMessageKey = settings.ffmpeg.message
    ? `settings.ffmpegMessage.${settings.ffmpeg.message}`
    : 'settings.ffmpegMessage.ffmpeg_or_ffprobe_missing';
  const ffmpegMessage =
    t(ffmpegMessageKey) === ffmpegMessageKey ? settings.ffmpeg.message ?? '' : t(ffmpegMessageKey);
  const ffmpegCheckedAt = formatCheckedAt(
    settings.ffmpeg.lastCheckedAt,
    language,
    t('settings.ffmpegNeverChecked')
  );

  const patchAndCheck = async (
    patch: Parameters<typeof settingsStore.patchSettings>[0],
    check = false
  ) => {
    await settingsStore.patchSettings(patch);
    if (check) {
      await settingsStore.checkFfmpeg();
    }
  };

  const handleAutoDetect = async () => {
    setDetectingFfmpeg(true);
    try {
      await settingsStore.checkFfmpeg({ autoDetect: true });
    } finally {
      setDetectingFfmpeg(false);
    }
  };

  const renderSection = () => {
    if (activeSection === 'general') {
      return (
        <div className="settings-section-stack">
          <div className="settings-card">
            <label className="field settings-field">
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
            <label className="field settings-field">
              <span>{t('common.theme')}</span>
              <select value={theme} onChange={(event) => setTheme(event.target.value as typeof theme)}>
                <option value="system">{t('common.system')}</option>
                <option value="light">{t('common.light')}</option>
                <option value="dark">{t('common.dark')}</option>
              </select>
            </label>
          </div>
        </div>
      );
    }

    if (activeSection === 'training') {
      return (
        <div className="settings-section-stack">
          <div className="settings-card settings-grid settings-card-grid">
            <PathField
              label={t('settings.defaultExportDir')}
              value={settings.defaultExportDir}
              onChange={(value) => void settingsStore.patchSettings({ defaultExportDir: value })}
              onBrowse={async () => {
                const next = await window.beatStride.selectExportDirectory();
                if (next) {
                  await settingsStore.patchSettings({ defaultExportDir: next });
                }
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
                if (next) {
                  await settingsStore.patchSettings({
                    defaultMetronomeSamplePath: next
                  });
                }
              }}
            />
            <label className="field settings-field">
              <span>{t('settings.defaultTargetBpm')}</span>
              <input
                type="number"
                value={settings.defaultTargetBpm}
                onChange={(event) =>
                  void settingsStore.patchSettings({ defaultTargetBpm: Number(event.target.value) })
                }
              />
            </label>
            <label className="field settings-field">
              <span>{t('settings.defaultFade')}</span>
              <input
                type="number"
                value={settings.defaultFadeMs}
                onChange={(event) =>
                  void settingsStore.patchSettings({ defaultFadeMs: Number(event.target.value) })
                }
              />
            </label>
            <label className="field settings-field">
              <span>{t('settings.normalize')}</span>
              <div className="settings-toggle-row">
                <div className="muted settings-inline-hint">{t('settings.normalizeHint')}</div>
                <input
                  type="checkbox"
                  className="settings-developer-toggle"
                  checked={settings.normalizeLoudnessByDefault}
                  onChange={(event) =>
                    void settingsStore.patchSettings({
                      normalizeLoudnessByDefault: event.target.checked
                    })
                  }
                />
              </div>
            </label>
          </div>
        </div>
      );
    }

    if (activeSection === 'ffmpeg') {
      return (
        <div className="settings-section-stack">
          <div className={`settings-card settings-status-card ${ffmpegStatusTone}`}>
            <div className="settings-status-header">
              <div>
                <span className="settings-status-kicker">{t('settings.ffmpegStatus')}</span>
                <strong className="settings-status-value">{ffmpegStatusLabel}</strong>
              </div>
              <button type="button" className="wire-btn" onClick={() => void handleAutoDetect()} disabled={detectingFfmpeg}>
                {detectingFfmpeg ? t('settings.ffmpegDetecting') : t('settings.ffmpegAutoDetect')}
              </button>
            </div>
            <div className="settings-status-grid">
              <div className="settings-status-item">
                <span>{t('settings.ffmpegDetectedPath')}</span>
                <strong>{settings.ffmpeg.ffmpegPath || settings.ffmpeg.ffprobePath || t('settings.ffmpegNoPath')}</strong>
              </div>
              <div className="settings-status-item">
                <span>{t('settings.ffmpegLastChecked')}</span>
                <strong>{ffmpegCheckedAt}</strong>
              </div>
              <div className="settings-status-item settings-status-item-wide">
                <span>{t('settings.ffmpegDetectMessage')}</span>
                <strong>{ffmpegMessage || t('settings.ffmpegMessage.ffmpeg_or_ffprobe_missing')}</strong>
              </div>
            </div>
          </div>
          <div className="settings-card settings-grid settings-card-grid">
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
                if (next) {
                  await patchAndCheck({
                    ffmpeg: { ...settings.ffmpeg, ffmpegPath: next }
                  }, true);
                }
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
                if (next) {
                  await patchAndCheck({
                    ffmpeg: { ...settings.ffmpeg, ffprobePath: next }
                  }, true);
                }
              }}
            />
          </div>
        </div>
      );
    }

    return (
      <div className="settings-section-stack">
        <div className="settings-card">
          <label className="field settings-field">
            <span>{t('settings.developerMode')}</span>
            <div className="settings-toggle-row">
              <div className="muted settings-inline-hint">{t('settings.developerModeHint')}</div>
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
    );
  };

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
          <div className="settings-header-copy">
            <span className="settings-header-kicker">{t('settings.title')}</span>
            <strong>{sectionMeta[activeSection].title}</strong>
            <span className="muted settings-drag-hint">{sectionMeta[activeSection].description}</span>
          </div>
          <div className="settings-header-actions" onMouseDown={(event) => event.stopPropagation()}>
            <span className="muted settings-drag-hint">{t('settings.windowHint')}</span>
            <button type="button" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </div>
        <div className="panel-content settings-center">
          <aside className="settings-sidebar">
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`settings-nav-item ${item.key === activeSection ? 'active' : ''}`}
                onClick={() => setActiveSection(item.key)}
              >
                <strong>{item.label}</strong>
                <span>{item.hint}</span>
              </button>
            ))}
          </aside>
          <div className="settings-main">{renderSection()}</div>
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
