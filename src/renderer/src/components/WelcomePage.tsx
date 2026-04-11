import type { AppSettings } from '@shared/types';
import { useI18n } from '@renderer/features/i18n/I18nProvider';
import { BrandMark } from '@renderer/components/BrandMark';

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
  const recentCount = settings.recentProjectPaths.length;

  return (
    <div className="welcome">
      <section className="welcome-card">
        <div className="welcome-hero">
          <BrandMark eyebrow={t('welcome.kicker')} subtitle={t('brand.tagline')} />
          <h1>{t('welcome.title')}</h1>
          <p className="muted welcome-hero-copy">{t('welcome.subtitle')}</p>
          <div className="welcome-badges">
            <span className="welcome-badge">{t('welcome.badgeAlignment')}</span>
            <span className="welcome-badge">{t('welcome.badgePreview')}</span>
            <span className="welcome-badge">{t('welcome.badgeExport')}</span>
          </div>
        </div>
        <div className="welcome-actions">
          <button className="primary" onClick={onCreateProject}>
            {t('welcome.newProject')}
          </button>
          <button onClick={onOpenProject}>{t('welcome.openProject')}</button>
          <button onClick={onRestoreRecovery}>{t('welcome.recovery')}</button>
        </div>
        <div className="welcome-grid">
          <div className="welcome-section welcome-section-emphasis">
            <h3>{t('welcome.launchStatus')}</h3>
            <div className="welcome-metrics">
              <div className="welcome-metric">
                <span className="welcome-metric-label">{t('welcome.ffmpegStatus')}</span>
                <strong>{hasFfmpeg ? t('welcome.ffmpegAvailable') : t('welcome.ffmpegMissing')}</strong>
              </div>
              <div className="welcome-metric">
                <span className="welcome-metric-label">{t('welcome.recentProjects')}</span>
                <strong>{recentCount}</strong>
              </div>
            </div>
            <p className="muted welcome-section-note">{settings.ffmpeg.ffmpegPath || '-'}</p>
          </div>
          <div className="welcome-section">
            <h3>{t('welcome.recentProjects')}</h3>
            {recentCount === 0 ? (
              <p className="muted welcome-section-note">{t('welcome.noRecentProjects')}</p>
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
        </div>
      </section>
    </div>
  );
}
