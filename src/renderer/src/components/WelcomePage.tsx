import type { AppSettings } from '@shared/types';
import { useI18n } from '@renderer/features/i18n/I18nProvider';

interface WelcomePageProps {
  settings: AppSettings;
  onCreateProject: () => void;
  onOpenProject: () => void;
  onRestoreRecovery: () => void;
  onOpenRecent: (path: string) => void;
}

export function WelcomePage({
  settings,
  onCreateProject,
  onOpenProject,
  onRestoreRecovery,
  onOpenRecent
}: WelcomePageProps) {
  const { t } = useI18n();
  const hasFfmpeg = settings.ffmpeg.available;

  return (
    <div className="welcome">
      <section className="welcome-card">
        <div className="welcome-hero">
          <h1>{t('welcome.title')}</h1>
          <p className="muted">{t('welcome.subtitle')}</p>
        </div>
        <div className="welcome-actions">
          <button className="primary" onClick={onCreateProject}>
            {t('welcome.newProject')}
          </button>
          <button onClick={onOpenProject}>{t('welcome.openProject')}</button>
          <button onClick={onRestoreRecovery}>{t('welcome.recovery')}</button>
        </div>
        <div className="welcome-section">
          <h3>{t('welcome.ffmpegStatus')}</h3>
          <p className="muted">
            {hasFfmpeg ? t('welcome.ffmpegAvailable') : t('welcome.ffmpegMissing')}
          </p>
          <p className="muted">{settings.ffmpeg.ffmpegPath || '-'}</p>
        </div>
        <div className="welcome-section">
          <h3>{t('welcome.recentProjects')}</h3>
          {settings.recentProjectPaths.length === 0 ? (
            <p className="muted">-</p>
          ) : (
            settings.recentProjectPaths.slice(0, 6).map((item) => (
              <button
                key={item}
                className="welcome-recent-button"
                onClick={() => onOpenRecent(item)}
              >
                {item}
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
