import { useEffect, useRef, useState } from 'react';
import type { ProjectFile, Track } from '@shared/types';
import { useI18n } from '@renderer/features/i18n/I18nProvider';
import { AlignmentPanel } from '@renderer/features/alignment/AlignmentPanel';

interface InspectorPanelProps {
  project: ProjectFile;
  track?: Track;
  onUpdateProject: (patch: Partial<ProjectFile>) => void;
  onUpdateTrack: (trackId: string, patch: Partial<Track>) => void;
}

export function InspectorPanel({
  project,
  track,
  onUpdateProject,
  onUpdateTrack
}: InspectorPanelProps) {
  const { t } = useI18n();
  const splitRootRef = useRef<HTMLDivElement | null>(null);
  const [topHeight, setTopHeight] = useState(290);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    if (!resizing) {
      return;
    }
    const handleMove = (event: MouseEvent) => {
      const root = splitRootRef.current;
      if (!root) {
        return;
      }
      const rect = root.getBoundingClientRect();
      const splitter = 8;
      const minTop = 180;
      const minBottom = 180;
      const rawTop = event.clientY - rect.top;
      const maxTop = rect.height - splitter - minBottom;
      const next = Math.max(minTop, Math.min(maxTop, rawTop));
      setTopHeight(next);
    };
    const handleUp = () => setResizing(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [resizing]);

  return (
    <aside className="panel">
      <div className="panel-header">
        <strong>处理参数</strong>
      </div>
      <div ref={splitRootRef} className="inspector-split no-drag">
        <div
          className="panel-content inspector-top"
          style={{ height: topHeight, borderBottom: '1px solid var(--line)' }}
        >
          <h4 style={{ margin: 0, marginBottom: 10 }}>节拍器调整 / 节拍器音乐修改 / 节拍调整</h4>
          <div className="properties-grid">
            <label className="field inline">
              <span>全局目标 BPM</span>
              <input
                type="number"
                value={project.globalTargetBpm}
                onChange={(event) =>
                  onUpdateProject({ globalTargetBpm: Number(event.target.value) || 180 })
                }
              />
            </label>
            <label className="field">
              <span>默认节拍器音色</span>
              <input
                value={project.defaultMetronomeSamplePath}
                onChange={(event) =>
                  onUpdateProject({ defaultMetronomeSamplePath: event.target.value })
                }
              />
            </label>
            <label className="field inline">
              <span>默认拍号</span>
              <input value={project.timeSignature} disabled />
            </label>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              上半区域固定用于节拍器和全局节奏设置
            </p>
          </div>
        </div>
        <div
          className={`row-splitter ${resizing ? 'active' : ''}`}
          onMouseDown={() => setResizing(true)}
        />
        <div className="panel-content inspector-bottom">
          <h4 style={{ margin: 0, marginBottom: 10 }}>对选择的歌曲做调整</h4>
          {!track ? (
            <p className="muted">{t('status.noTrackSelected')}</p>
          ) : (
            <>
              <div className="properties-grid">
                <label className="field inline">
                  <span>{t('inspector.trimIn')}</span>
                  <input
                    type="number"
                    value={track.trimInMs}
                    onChange={(event) =>
                      onUpdateTrack(track.id, { trimInMs: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="field inline">
                  <span>{t('inspector.trimOut')}</span>
                  <input
                    type="number"
                    value={track.trimOutMs}
                    onChange={(event) =>
                      onUpdateTrack(track.id, { trimOutMs: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="field inline">
                  <span>{t('inspector.fadeIn')}</span>
                  <input
                    type="number"
                    value={track.fadeInMs}
                    onChange={(event) =>
                      onUpdateTrack(track.id, { fadeInMs: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="field inline">
                  <span>{t('inspector.fadeOut')}</span>
                  <input
                    type="number"
                    value={track.fadeOutMs}
                    onChange={(event) =>
                      onUpdateTrack(track.id, { fadeOutMs: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="field inline">
                  <span>{t('inspector.volumeDb')}</span>
                  <input
                    type="number"
                    value={track.volumeDb}
                    onChange={(event) =>
                      onUpdateTrack(track.id, { volumeDb: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="field inline">
                  <span>{t('inspector.pan')}</span>
                  <input
                    type="number"
                    step={0.1}
                    min={-1}
                    max={1}
                    value={track.pan}
                    onChange={(event) => onUpdateTrack(track.id, { pan: Number(event.target.value) })}
                  />
                </label>
                <label className="field inline">
                  <span>{t('inspector.metronomeEnabled')}</span>
                  <input
                    type="checkbox"
                    checked={track.metronomeEnabled}
                    onChange={(event) =>
                      onUpdateTrack(track.id, { metronomeEnabled: event.target.checked })
                    }
                  />
                </label>
                <label className="field inline">
                  <span>{t('inspector.metronomeVolumeDb')}</span>
                  <input
                    type="number"
                    value={track.metronomeVolumeDb}
                    onChange={(event) =>
                      onUpdateTrack(track.id, { metronomeVolumeDb: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="field inline">
                  <span>{t('inspector.exportEnabled')}</span>
                  <input
                    type="checkbox"
                    checked={track.exportEnabled}
                    onChange={(event) =>
                      onUpdateTrack(track.id, { exportEnabled: event.target.checked })
                    }
                  />
                </label>
              </div>
              <AlignmentPanel
                track={track}
                onUpdate={(patch) => onUpdateTrack(track.id, patch)}
              />
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
