import { formatMs } from '@shared/utils/time';
import type { Track } from '@shared/types';
import { useI18n } from '@renderer/features/i18n/I18nProvider';

interface TrackLibraryPanelProps {
  tracks: Track[];
  checkedTrackIds: string[];
  onImport: () => void;
  onImportFolder: () => void;
  onToggleTrack: (trackId: string) => void;
  onToggleAll: (checked: boolean) => void;
  onDeleteChecked: () => void;
  onAddCheckedToTimeline: () => void;
}

export function TrackLibraryPanel({
  tracks,
  checkedTrackIds,
  onImport,
  onImportFolder,
  onToggleTrack,
  onToggleAll,
  onDeleteChecked,
  onAddCheckedToTimeline
}: TrackLibraryPanelProps) {
  const { t, language } = useI18n();
  const allChecked = tracks.length > 0 && checkedTrackIds.length === tracks.length;

  return (
    <aside className="panel">
      <div className="panel-header no-drag">
        <strong className="library-title">{t('library.title')}</strong>
        <div className="library-actions">
          <button className="pill library-btn" onClick={onImport}>{t('library.importButton')}</button>
          <button className="pill library-btn" onClick={onImportFolder}>导入文件夹</button>
          <button className="pill library-btn" onClick={onDeleteChecked}>{t('common.delete')}</button>
        </div>
      </div>
      <div className="panel-content no-drag">
        <div className="library-select-row">
          <label className="library-check-all">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={(event) => onToggleAll(event.target.checked)}
            />
            <span>全选</span>
          </label>
          <button className="pill primary library-btn" onClick={onAddCheckedToTimeline}>加入时间线</button>
        </div>
        {tracks.length === 0 ? (
          <p className="muted">{t('library.empty')}</p>
        ) : (
          tracks.map((track) => {
            const selected = checkedTrackIds.includes(track.id);
            return (
              <div
                key={track.id}
                className={`track-item ${selected ? 'selected' : ''}`}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => onToggleTrack(track.id)}
                    />
                    <strong>{track.name}</strong>
                  </label>
                  <span className="muted">{Math.round(track.sourceBpm)} BPM</span>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {t('library.duration')}: {formatMs(track.durationMs, language)}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {t('library.sampleRate')}: {track.sampleRate}Hz / {t('library.channels')}:{' '}
                  {track.channels}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  状态: {track.inTimeline ? '已在时间线' : '仅在项目中'}
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
