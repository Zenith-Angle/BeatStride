import { useState } from 'react';
import type { ProjectFile, Track } from '@shared/types';
import { useI18n } from '@renderer/features/i18n/I18nProvider';
import { useExportStore } from '@renderer/stores/exportStore';

interface ExportPanelProps {
  project: ProjectFile;
  selectedTrack?: Track;
  onClose: () => void;
}

export function ExportPanel({
  project,
  selectedTrack,
  onClose
}: ExportPanelProps) {
  const { t } = useI18n();
  const exportStore = useExportStore();
  const [mode, setMode] = useState<'single' | 'medley'>(project.exportPreset.mode);
  const [format, setFormat] = useState<'wav' | 'mp3'>(project.exportPreset.format);
  const [bitrateKbps, setBitrateKbps] = useState(project.exportPreset.bitrateKbps);
  const [outputDir, setOutputDir] = useState(project.exportPreset.outputDir);

  const activeJob = exportStore.jobs[0];

  const pickOutputDir = async () => {
    const dir = await window.beatStride.selectExportDirectory();
    if (dir) {
      setOutputDir(dir);
    }
  };

  const runExport = async () => {
    if (mode === 'single' && selectedTrack) {
      await exportStore.exportSingleTrack(selectedTrack, project, {
        outputDir,
        format,
        bitrateKbps
      });
      return;
    }
    await exportStore.exportMedley(project, { outputDir, format, bitrateKbps });
  };

  return (
    <section
      className="panel no-drag"
      style={{
        position: 'absolute',
        right: 20,
        top: 64,
        width: 360,
        maxHeight: '80vh',
        border: '1px solid var(--line)',
        borderRadius: 14,
        background: 'var(--bg-elevated)',
        boxShadow: 'var(--shadow-md)',
        zIndex: 20
      }}
    >
      <div className="panel-header">
        <strong>{t('export.title')}</strong>
        <button onClick={onClose}>{t('common.close')}</button>
      </div>
      <div className="panel-content">
        <label className="field">
          <span>{t('export.mode')}</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
            <option value="single">{t('export.modeSingle')}</option>
            <option value="medley">{t('export.modeMedley')}</option>
          </select>
        </label>
        <label className="field">
          <span>{t('export.format')}</span>
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value as typeof format)}
          >
            <option value="wav">wav</option>
            <option value="mp3">mp3</option>
          </select>
        </label>
        <label className="field">
          <span>{t('export.bitrate')}</span>
          <input
            type="number"
            value={bitrateKbps}
            onChange={(event) => setBitrateKbps(Number(event.target.value))}
          />
        </label>
        <label className="field">
          <span>{t('export.outputDir')}</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
            <input
              value={outputDir}
              onChange={(event) => setOutputDir(event.target.value)}
              placeholder="C:\\Exports"
            />
            <button onClick={pickOutputDir}>...</button>
          </div>
        </label>
        <button className="primary" onClick={runExport} style={{ width: '100%', marginTop: 10 }}>
          {t('export.run')}
        </button>
        {activeJob && (
          <div style={{ marginTop: 12 }}>
            <div className="muted">
              {activeJob.status === 'running' ? t('export.running') : activeJob.status}
            </div>
            <progress value={activeJob.progress} max={1} style={{ width: '100%' }} />
            {activeJob.outputPath && (
              <button style={{ marginTop: 8 }} onClick={() => window.beatStride.openPath(activeJob.outputPath!)}>
                {t('export.completed')}
              </button>
            )}
            {activeJob.error && <div style={{ color: 'var(--danger)' }}>{activeJob.error}</div>}
          </div>
        )}
      </div>
    </section>
  );
}
