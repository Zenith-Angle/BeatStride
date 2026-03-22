import { useI18n } from '@renderer/features/i18n/I18nProvider';
import { useState } from 'react';
import colorLogo from '@renderer/assets/bs-color.png';
import monoLogo from '@renderer/assets/bs-mono.png';

interface TitleBarProps {
  projectName?: string;
  onOpenSettings: () => void;
  onExport: () => void;
}

export function TitleBar({
  projectName,
  onOpenSettings,
  onExport
}: TitleBarProps) {
  const { t } = useI18n();
  const [monoMissing, setMonoMissing] = useState(false);
  const [colorMissing, setColorMissing] = useState(false);

  return (
    <header className="titlebar">
      <div className="drag-area">
        {monoMissing ? (
          <div className="logo-fallback mono">SB</div>
        ) : (
          <img
            className="logo mono"
            src={monoLogo}
            alt="BeatStride mono logo"
            onError={() => setMonoMissing(true)}
          />
        )}
        <strong>{projectName ?? t('app.title')}</strong>
      </div>
      <div className="toolbar-actions no-drag">
        <button className="pill primary" onClick={onExport}>
          {t('common.export')}
        </button>
        <button className="pill" onClick={onOpenSettings}>{t('common.settings')}</button>
        {colorMissing ? (
          <div className="logo-fallback color">SB</div>
        ) : (
          <img
            className="logo color"
            src={colorLogo}
            alt="BeatStride color logo"
            onError={() => setColorMissing(true)}
          />
        )}
      </div>
    </header>
  );
}
