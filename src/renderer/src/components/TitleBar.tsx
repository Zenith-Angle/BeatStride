import { useI18n } from '@renderer/features/i18n/I18nProvider';

interface TitleBarProps {
  projectName?: string;
  onOpenSettings: () => void;
  onExport: () => void;
  onImport: () => void;
  onImportFolder: () => void;
}

export function TitleBar({
  projectName,
  onOpenSettings,
  onExport,
  onImport,
  onImportFolder
}: TitleBarProps) {
  const { t } = useI18n();

  return (
    <header className="titlebar">
      <div className="drag-area no-drag top-action-strip">
        <button className="wire-btn" onClick={onImport}>
          导入文件
        </button>
        <button className="wire-btn" onClick={onImportFolder}>
          导入文件夹
        </button>
        <button className="wire-btn" onClick={onOpenSettings}>
          {t('common.settings')}
        </button>
        {projectName && <span className="muted">{projectName}</span>}
      </div>
      <div className="toolbar-actions no-drag">
        <button className="export-box" onClick={onExport}>
          {t('common.export')}
        </button>
      </div>
    </header>
  );
}
