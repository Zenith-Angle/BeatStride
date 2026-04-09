import { useEffect, useState } from 'react';
import type { ProjectFile, Track } from '@shared/types';
import { buildSingleTrackExportPlan } from '@shared/services/exportPlanService';
import { buildMedleyOutputBaseName } from '@shared/utils/fileName';
import { useI18n } from '@renderer/features/i18n/I18nProvider';
import { useAppSettingsStore } from '@renderer/stores/appSettingsStore';
import { useExportStore } from '@renderer/stores/exportStore';
import { useProjectStore } from '@renderer/stores/projectStore';

interface ExportPanelProps {
  project: ProjectFile;
  selectedTrack?: Track;
  onClose: () => void;
}

function getParentDirectory(filePath?: string): string {
  if (!filePath) {
    return '';
  }
  const separatorIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return separatorIndex >= 0 ? filePath.slice(0, separatorIndex) : '';
}

function resolveDefaultOutputDir(project: ProjectFile, settingsDefaultDir?: string): string {
  return (
    project.exportPreset.outputDir ||
    getParentDirectory(project.meta.filePath) ||
    settingsDefaultDir ||
    ''
  );
}

function joinDisplayPath(outputDir: string, fileName: string, format: 'wav' | 'mp3'): string {
  const safeBaseName = fileName.trim() || '未命名导出';
  if (!outputDir) {
    return `${safeBaseName}.${format}`;
  }
  const separator = outputDir.includes('\\') ? '\\' : '/';
  const suffix = outputDir.endsWith('\\') || outputDir.endsWith('/') ? '' : separator;
  return `${outputDir}${suffix}${safeBaseName}.${format}`;
}

function buildDefaultSingleOutputBaseName(project: ProjectFile, track?: Track): string {
  if (!track) {
    return '';
  }
  return buildSingleTrackExportPlan(track, {
    globalTargetBpm: project.globalTargetBpm,
    outputDir: project.exportPreset.outputDir,
    format: project.exportPreset.format,
    metronomeSamplePath: project.defaultMetronomeSamplePath,
    normalizeLoudness: project.mixTuning.loudnormEnabled,
    projectFilePath: project.meta.filePath,
    mixTuning: project.mixTuning
  }).track.outputBaseName;
}

function buildDefaultMedleyOutputBaseName(project: ProjectFile): string {
  return buildMedleyOutputBaseName(project.meta.name, project.exportPreset.medleyBaseName);
}

export function ExportPanel({
  project,
  selectedTrack,
  onClose
}: ExportPanelProps) {
  const { t } = useI18n();
  const exportStore = useExportStore();
  const appSettings = useAppSettingsStore((state) => state.settings);
  const patchProject = useProjectStore((state) => state.patchProject);
  const [mode, setMode] = useState<'single' | 'medley'>(project.exportPreset.mode);
  const [format, setFormat] = useState<'wav' | 'mp3'>(project.exportPreset.format);
  const [bitrateKbps, setBitrateKbps] = useState(project.exportPreset.bitrateKbps);
  const [outputDir, setOutputDir] = useState(
    resolveDefaultOutputDir(project, appSettings.defaultExportDir)
  );
  const [outputBaseName, setOutputBaseName] = useState(
    project.exportPreset.mode === 'single'
      ? buildDefaultSingleOutputBaseName(project, selectedTrack)
      : buildDefaultMedleyOutputBaseName(project)
  );

  const activeJob = exportStore.jobs[0];
  const singleBlocked = mode === 'single' && !selectedTrack;
  const displayPath = joinDisplayPath(outputDir, outputBaseName, format);

  useEffect(() => {
    setOutputDir(resolveDefaultOutputDir(project, appSettings.defaultExportDir));
  }, [project.exportPreset.outputDir, project.meta.filePath, appSettings.defaultExportDir]);

  useEffect(() => {
    setOutputBaseName(
      mode === 'single'
        ? buildDefaultSingleOutputBaseName(project, selectedTrack)
        : buildDefaultMedleyOutputBaseName(project)
    );
  }, [
    mode,
    selectedTrack?.id,
    selectedTrack?.name,
    selectedTrack?.targetBpm,
    selectedTrack?.sourceBpm,
    selectedTrack?.metronomeEnabled,
    project.globalTargetBpm,
    project.defaultMetronomeSamplePath,
    project.mixTuning,
    project.exportPreset.medleyBaseName,
    project.meta.name
  ]);

  const persistExportPreset = (patch: Partial<ProjectFile['exportPreset']>) => {
    patchProject({
      exportPreset: {
        ...project.exportPreset,
        ...patch
      }
    });
  };

  const pickOutputDir = async () => {
    const dir = await window.beatStride.selectExportDirectory();
    if (dir) {
      setOutputDir(dir);
      persistExportPreset({ outputDir: dir });
    }
  };

  const commitExportPreset = () => {
    persistExportPreset({
      outputDir,
      mode,
      format,
      bitrateKbps,
      medleyBaseName: mode === 'medley' ? outputBaseName.trim() : project.exportPreset.medleyBaseName
    });
  };

  const runExport = async () => {
    if (mode === 'single' && !selectedTrack) {
      return;
    }
    commitExportPreset();
    if (mode === 'single' && selectedTrack) {
      await exportStore.exportSingleTrack(selectedTrack, project, {
        outputDir,
        format,
        bitrateKbps,
        outputBaseName: outputBaseName.trim() || buildDefaultSingleOutputBaseName(project, selectedTrack)
      });
      return;
    }
    await exportStore.exportMedley(project, {
      outputDir,
      format,
      bitrateKbps,
      outputBaseName: outputBaseName.trim() || buildDefaultMedleyOutputBaseName(project)
    });
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
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
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
              onBlur={() => persistExportPreset({ outputDir })}
              placeholder={
                getParentDirectory(project.meta.filePath) ||
                appSettings.defaultExportDir ||
                '未保存工程时会回退到系统默认目录'
              }
            />
            <button onClick={pickOutputDir}>...</button>
          </div>
        </label>
        <label className="field">
          <span>{mode === 'single' ? '单曲导出名' : '串烧导出名'}</span>
          <input
            value={outputBaseName}
            onChange={(event) => setOutputBaseName(event.target.value)}
            onBlur={() => {
              if (mode === 'medley') {
                persistExportPreset({ medleyBaseName: outputBaseName.trim() });
              }
            }}
            placeholder={mode === 'single' ? '当前单曲导出文件名' : '默认使用工程名'}
            disabled={mode === 'single' && !selectedTrack}
          />
        </label>
        <div className="muted export-path-preview">导出路径：{displayPath}</div>
        <div className="muted export-tuning-hint">
          当前微调:
          {' '}
          {project.mixTuning.stretchEngine}
          {' / '}
          {project.mixTuning.beatRenderMode}
          {' / '}
          {project.mixTuning.loudnormEnabled
            ? `loudnorm ${project.mixTuning.targetLufs} LUFS`
            : 'loudnorm 关闭'}
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
