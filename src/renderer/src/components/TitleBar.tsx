import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import type { MenuCommandPayload } from '@shared/ipc';
import type { ThemeMode } from '@shared/types';
import { BrandMark } from '@renderer/components/BrandMark';
import { useI18n } from '@renderer/features/i18n/I18nProvider';
import { useTheme } from '@renderer/features/theme/ThemeProvider';

type TitleBarMode = 'welcome' | 'editor';
type OpenMenuKey = 'project' | 'utility' | null;
type MenuAlign = 'start' | 'end';

type MenuEntry =
  | {
      kind: 'action';
      key: string;
      label: string;
      shortcut?: string;
      disabled?: boolean;
      onSelect: () => void;
    }
  | {
      kind: 'divider';
      key: string;
    };

interface TitleBarProps {
  mode: TitleBarMode;
  projectName?: string;
  developerMode?: boolean;
  onCreateProject: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onSaveProjectAs: () => void;
  onOpenSettings: () => void;
  onExecuteMenuCommand: (command: MenuCommandPayload) => void;
  onSetTheme: (theme: ThemeMode) => void;
  onExport?: () => void;
  onImport?: () => void;
  onImportFolder?: () => void;
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
}

function ThemeGlyph({ resolvedTheme }: { resolvedTheme: 'light' | 'dark' }) {
  if (resolvedTheme === 'dark') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M14.5 3.5a8.5 8.5 0 1 0 6 14.5 9 9 0 0 1-10-10 8.5 8.5 0 0 0 4-4.5Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" fill="currentColor" />
      <path
        d="M12 2.5v2.3M12 19.2v2.3M21.5 12h-2.3M4.8 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4.2 6.1 8 9.9l3.8-3.8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function KebabGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="5" r="1.9" fill="currentColor" />
      <circle cx="12" cy="12" r="1.9" fill="currentColor" />
      <circle cx="12" cy="19" r="1.9" fill="currentColor" />
    </svg>
  );
}

function containsNode(root: HTMLElement | null, target: Node | null): boolean {
  return Boolean(root && target && root.contains(target));
}

function getMenuPosition(trigger: HTMLElement, align: MenuAlign): MenuPosition {
  const rect = trigger.getBoundingClientRect();
  const width = align === 'start' ? 252 : 240;
  const left =
    align === 'start'
      ? Math.min(rect.left, window.innerWidth - width - 16)
      : Math.max(16, rect.right - width);

  return {
    top: rect.bottom + 10,
    left: Math.max(16, left),
    width
  };
}

export function TitleBar({
  mode,
  projectName,
  developerMode = false,
  onCreateProject,
  onOpenProject,
  onSaveProject,
  onSaveProjectAs,
  onOpenSettings,
  onExecuteMenuCommand,
  onSetTheme,
  onExport,
  onImport,
  onImportFolder
}: TitleBarProps) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const [openMenuKey, setOpenMenuKey] = useState<OpenMenuKey>(null);
  const [menuPosition, setMenuPosition] = useState<Record<'project' | 'utility', MenuPosition | null>>({
    project: null,
    utility: null
  });
  const projectTriggerRef = useRef<HTMLButtonElement | null>(null);
  const utilityTriggerRef = useRef<HTMLButtonElement | null>(null);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  const utilityMenuRef = useRef<HTMLDivElement | null>(null);
  const isMac =
    typeof navigator !== 'undefined' &&
    /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
  const modifierKey = isMac ? 'Cmd' : 'Ctrl';
  const quickTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
  const canSave = mode === 'editor';

  const updateMenuPosition = (key: Exclude<OpenMenuKey, null>) => {
    const trigger = key === 'project' ? projectTriggerRef.current : utilityTriggerRef.current;
    if (!trigger) {
      return;
    }
    setMenuPosition((current) => ({
      ...current,
      [key]: getMenuPosition(trigger, key === 'project' ? 'start' : 'end')
    }));
  };

  useEffect(() => {
    if (!openMenuKey) {
      return;
    }

    updateMenuPosition(openMenuKey);
    const handleReposition = () => updateMenuPosition(openMenuKey);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [openMenuKey]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      const insideProject =
        containsNode(projectTriggerRef.current, target) || containsNode(projectMenuRef.current, target);
      const insideUtility =
        containsNode(utilityTriggerRef.current, target) || containsNode(utilityMenuRef.current, target);

      if (!insideProject && !insideUtility) {
        setOpenMenuKey(null);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenuKey(null);
      }
    };
    const handleWindowBlur = () => {
      setOpenMenuKey(null);
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []);

  const projectEntries = useMemo<MenuEntry[]>(
    () => [
      {
        kind: 'action',
        key: 'project-new',
        label: t('menu.newProject'),
        shortcut: `${modifierKey}+N`,
        onSelect: onCreateProject
      },
      {
        kind: 'action',
        key: 'project-open',
        label: t('menu.openProject'),
        shortcut: `${modifierKey}+O`,
        onSelect: onOpenProject
      },
      { kind: 'divider', key: 'project-divider-1' },
      {
        kind: 'action',
        key: 'project-save',
        label: t('common.save'),
        shortcut: `${modifierKey}+S`,
        disabled: !canSave,
        onSelect: onSaveProject
      },
      {
        kind: 'action',
        key: 'project-save-as',
        label: t('common.saveAs'),
        shortcut: `${modifierKey}+Shift+S`,
        disabled: !canSave,
        onSelect: onSaveProjectAs
      },
      { kind: 'divider', key: 'project-divider-2' },
      {
        kind: 'action',
        key: 'project-settings',
        label: t('common.settings'),
        shortcut: `${modifierKey},`,
        onSelect: onOpenSettings
      },
      { kind: 'divider', key: 'project-divider-3' },
      {
        kind: 'action',
        key: 'project-quit',
        label: t('menu.exit'),
        onSelect: () => onExecuteMenuCommand('app:quit')
      }
    ],
    [
      canSave,
      modifierKey,
      onCreateProject,
      onExecuteMenuCommand,
      onOpenProject,
      onOpenSettings,
      onSaveProject,
      onSaveProjectAs,
      t
    ]
  );

  const utilityEntries = useMemo<MenuEntry[]>(() => {
    const entries: MenuEntry[] = [
      {
        kind: 'action',
        key: 'utility-about',
        label: t('menu.about'),
        onSelect: () => onExecuteMenuCommand('help:about')
      },
      { kind: 'divider', key: 'utility-divider-1' },
      {
        kind: 'action',
        key: 'utility-reload',
        label: t('menu.reload'),
        shortcut: `${modifierKey}+R`,
        onSelect: () => onExecuteMenuCommand('view:reload')
      },
      {
        kind: 'action',
        key: 'utility-reset-zoom',
        label: t('menu.resetZoom'),
        shortcut: `${modifierKey}+0`,
        onSelect: () => onExecuteMenuCommand('view:resetZoom')
      },
      {
        kind: 'action',
        key: 'utility-zoom-in',
        label: t('menu.zoomIn'),
        shortcut: `${modifierKey}+=`,
        onSelect: () => onExecuteMenuCommand('view:zoomIn')
      },
      {
        kind: 'action',
        key: 'utility-zoom-out',
        label: t('menu.zoomOut'),
        shortcut: `${modifierKey}+-`,
        onSelect: () => onExecuteMenuCommand('view:zoomOut')
      },
      {
        kind: 'action',
        key: 'utility-fullscreen',
        label: t('menu.toggleFullscreen'),
        shortcut: isMac ? `Ctrl+${modifierKey}+F` : 'F11',
        onSelect: () => onExecuteMenuCommand('view:toggleFullscreen')
      }
    ];

    if (developerMode) {
      entries.push({ kind: 'divider', key: 'utility-divider-2' });
      entries.push({
        kind: 'action',
        key: 'utility-devtools',
        label: t('menu.toggleDevTools'),
        shortcut: isMac ? `Alt+${modifierKey}+I` : `${modifierKey}+Shift+I`,
        onSelect: () => onExecuteMenuCommand('view:toggleDevTools')
      });
    }

    return entries;
  }, [developerMode, isMac, modifierKey, onExecuteMenuCommand, t]);

  const handleMenuSelect = (entry: MenuEntry) => {
    if (entry.kind !== 'action' || entry.disabled) {
      return;
    }
    entry.onSelect();
    setOpenMenuKey(null);
  };

  const renderMenu = (
    key: Exclude<OpenMenuKey, null>,
    entries: MenuEntry[],
    menuRef: MutableRefObject<HTMLDivElement | null>
  ) => {
    if (openMenuKey !== key || !menuPosition[key] || typeof document === 'undefined') {
      return null;
    }

    return createPortal(
      <div
        ref={menuRef}
        className={`titlebar-menu-portal titlebar-menu-portal-${key}`}
        role="menu"
        style={menuPosition[key] ?? undefined}
      >
        {entries.map((entry) => {
          if (entry.kind === 'divider') {
            return <div key={entry.key} className="titlebar-menu-divider" />;
          }
          return (
            <button
              key={entry.key}
              type="button"
              role="menuitem"
              className={`titlebar-menu-item ${entry.disabled ? 'disabled' : ''}`}
              onClick={() => handleMenuSelect(entry)}
            >
              <span className="titlebar-menu-text">{entry.label}</span>
              <span className="titlebar-menu-shortcut">{entry.shortcut ?? ''}</span>
            </button>
          );
        })}
      </div>,
      document.body
    );
  };

  return (
    <>
      <header className={`titlebar titlebar-${mode}`}>
        <div className="titlebar-left">
          <div className="drag-area titlebar-brand-strip">
            <BrandMark
              compact
              eyebrow={mode === 'editor' ? t('toolbar.trainingDesk') : undefined}
              subtitle={mode === 'editor' ? t('brand.taglineCompact') : undefined}
            />
          </div>
          {mode === 'editor' ? (
            <div className="titlebar-import-group no-drag">
              <button type="button" className="wire-btn titlebar-action-btn" onClick={() => onImport?.()}>
                {t('toolbar.importFile')}
              </button>
              <button
                type="button"
                className="wire-btn titlebar-action-btn"
                onClick={() => onImportFolder?.()}
              >
                {t('toolbar.importFolder')}
              </button>
            </div>
          ) : null}
        </div>

        {mode === 'editor' ? (
          <div className="titlebar-center">
            <div className="drag-area titlebar-project-meta">
              <span className="titlebar-project-label">{t('toolbar.currentProject')}</span>
              <strong className="titlebar-project-name">{projectName || t('toolbar.projectPending')}</strong>
            </div>
            <button
              ref={projectTriggerRef}
              type="button"
              className={`titlebar-entry-trigger no-drag ${openMenuKey === 'project' ? 'active' : ''}`}
              aria-expanded={openMenuKey === 'project'}
              title={t('toolbar.projectMenu')}
              onClick={() => setOpenMenuKey(openMenuKey === 'project' ? null : 'project')}
            >
              <span className="titlebar-entry-label">{t('toolbar.project')}</span>
              <span className="titlebar-entry-icon">
                <ChevronGlyph />
              </span>
            </button>
          </div>
        ) : (
          <div className="titlebar-center titlebar-center-welcome" />
        )}

        <div className="titlebar-right no-drag">
          <button
            type="button"
            className="theme-toggle-btn"
            title={t(quickTheme === 'dark' ? 'menu.switchToDark' : 'menu.switchToLight')}
            onClick={() => onSetTheme(quickTheme)}
          >
            <span className="theme-toggle-icon">
              <ThemeGlyph resolvedTheme={resolvedTheme} />
            </span>
            <span className="theme-toggle-label">
              {t(resolvedTheme === 'dark' ? 'common.dark' : 'common.light')}
            </span>
          </button>

          {mode === 'editor' ? (
            <>
              <button type="button" className="wire-btn titlebar-action-btn" onClick={onOpenSettings}>
                {t('common.settings')}
              </button>
              <button type="button" className="export-box" onClick={() => onExport?.()}>
                {t('common.export')}
              </button>
              <button
                ref={utilityTriggerRef}
                type="button"
                className={`titlebar-icon-btn ${openMenuKey === 'utility' ? 'active' : ''}`}
                aria-expanded={openMenuKey === 'utility'}
                title={t('toolbar.tools')}
                onClick={() => setOpenMenuKey(openMenuKey === 'utility' ? null : 'utility')}
              >
                <KebabGlyph />
              </button>
            </>
          ) : null}
        </div>
      </header>
      {renderMenu('project', projectEntries, projectMenuRef)}
      {renderMenu('utility', utilityEntries, utilityMenuRef)}
    </>
  );
}
