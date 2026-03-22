import { LANGUAGE_OPTIONS } from '@renderer/features/i18n/messages';
import { useI18n } from '@renderer/features/i18n/I18nProvider';
import { useTheme } from '@renderer/features/theme/ThemeProvider';
import { useAppSettingsStore } from '@renderer/stores/appSettingsStore';

interface SettingsPageProps {
  onClose: () => void;
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const { t, language, setLanguage } = useI18n();
  const { theme, setTheme } = useTheme();
  const settingsStore = useAppSettingsStore();
  const settings = settingsStore.settings;

  return (
    <section
      className="panel no-drag"
      style={{
        position: 'absolute',
        inset: 60,
        borderRadius: 16,
        border: '1px solid var(--line)',
        boxShadow: 'var(--shadow-md)',
        background: 'var(--bg-elevated)',
        zIndex: 30
      }}
    >
      <div className="panel-header">
        <strong>{t('settings.title')}</strong>
        <button onClick={onClose}>{t('common.close')}</button>
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
          <label className="field">
            <span>{t('settings.defaultExportDir')}</span>
            <input
              value={settings.defaultExportDir}
              onChange={(event) =>
                void settingsStore.patchSettings({ defaultExportDir: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>{t('settings.ffmpegPath')}</span>
            <input
              value={settings.ffmpeg.ffmpegPath}
              onChange={(event) =>
                void settingsStore.patchSettings({
                  ffmpeg: { ...settings.ffmpeg, ffmpegPath: event.target.value }
                })
              }
            />
          </label>
          <label className="field">
            <span>{t('settings.ffprobePath')}</span>
            <input
              value={settings.ffmpeg.ffprobePath}
              onChange={(event) =>
                void settingsStore.patchSettings({
                  ffmpeg: { ...settings.ffmpeg, ffprobePath: event.target.value }
                })
              }
            />
          </label>
          <label className="field">
            <span>{t('settings.defaultMetronomeSample')}</span>
            <input
              value={settings.defaultMetronomeSamplePath}
              onChange={(event) =>
                void settingsStore.patchSettings({
                  defaultMetronomeSamplePath: event.target.value
                })
              }
            />
          </label>
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
        </div>
      </div>
    </section>
  );
}
