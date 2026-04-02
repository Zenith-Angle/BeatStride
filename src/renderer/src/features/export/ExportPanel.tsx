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
  const singleBlocked = mode === 'single' && !selectedTrack;

  const pickOutputDir = async () => {
    const dir = await window.beatStride.selectExportDirectory();
    if (dir) {
      setOutputDir(dir);
    }
  };

  const runExport = async () => {
    if (mode === 'single' && !selectedTrack) {
      return;
    }
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
    <section className="panel no-drag floating-panel export-panel">
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
          <div className="path-field-row">
            <input
              value={outputDir}
              onChange={(event) => setOutputDir(event.target.value)}
              placeholder="C:\\Exports"
            />
            <button onClick={pickOutputDir}>...</button>
          </div>
        </label>
        <div className="muted export-tuning-hint">
          当前微调:
          {' '}
          {project.mixTuning.stretchEngine}
          {' / '}
          {project.mixTuning.beatRenderMode}
          {' / '}
          {project.mixTuning.loudnormEnabled ? `loudnorm ${project.mixTuning.targetLufs} LUFS` : 'loudnorm 关闭'}
        </div>
        {singleBlocked && (
          <div className="export-warning">
            单曲导出需要先在工作区选中一首歌曲。
          </div>
        )}
        <button className="primary export-run-button" onClick={runExport} disabled={singleBlocked}>
          {t('export.run')}
        </button>
        {activeJob && (
          <div className="export-job-status">
            <div className="muted">
              {activeJob.status === 'running' ? t('export.running') : activeJob.status}
            </div>
            <progress className="export-progress" value={activeJob.progress} max={1} />
            {activeJob.outputPath && (
              <button
                className="export-open-output"
                onClick={() => window.beatStride.openPath(activeJob.outputPath!)}
              >
                {t('export.completed')}
              </button>
            )}
            {activeJob.error && <div className="export-error">{activeJob.error}</div>}
          </div>
        )}
      </div>
    </section>
  );
}
