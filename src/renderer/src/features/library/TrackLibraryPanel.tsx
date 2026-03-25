import { formatMs } from '@shared/utils/time';
import type { Track } from '@shared/types';
import { useI18n } from '@renderer/features/i18n/I18nProvider';

interface TrackLibraryPanelProps {
  tracks: Track[];
  checkedTrackIds: string[];
  selectedTrackId?: string;
  onSelectTrack: (trackId: string) => void;
  onToggleTrack: (trackId: string) => void;
  onToggleAll: (checked: boolean) => void;
  onIncludeCheckedInMedley: () => void;
  onRemoveChecked: () => void;
}

export function TrackLibraryPanel({
  tracks,
  checkedTrackIds,
  selectedTrackId,
  onSelectTrack,
  onToggleTrack,
  onToggleAll,
  onIncludeCheckedInMedley,
  onRemoveChecked
}: TrackLibraryPanelProps) {
  const { t, language } = useI18n();
  const allChecked = tracks.length > 0 && checkedTrackIds.length === tracks.length;

  return (
    <aside className="panel">
      <div className="left-workspace no-drag">
        <div className="left-library-frame">
          <div className="left-sidebar-shell">
            <div className="left-song-box">
              <div className="left-song-box-title">
                <label className="library-check-all">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={(event) => onToggleAll(event.target.checked)}
                  />
                  <span>全选</span>
                </label>
                <strong className="section-title">待加载区</strong>
                <button className="wire-btn" onClick={onIncludeCheckedInMedley}>
                  加入列表
                </button>
              </div>
              <div className="left-song-list">
                {tracks.length === 0 ? (
                  <p className="muted">{t('library.empty')}</p>
                ) : (
                  tracks.map((track) => {
                    const selected = checkedTrackIds.includes(track.id);
                    const active = selectedTrackId === track.id;
                    return (
                      <div
                        key={track.id}
                        className={`track-item ${selected ? 'selected' : ''} ${active ? 'active' : ''}`}
                        onClick={() => onSelectTrack(track.id)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <label
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              minWidth: 0
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => onToggleTrack(track.id)}
                              onClick={(event) => event.stopPropagation()}
                            />
                            <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {track.name}
                            </strong>
                          </label>
                          <span className="muted">{Math.round(track.sourceBpm)} BPM</span>
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {t('library.duration')}: {formatMs(track.durationMs, language)}
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          状态: {track.exportEnabled ? '已加入列表' : '未加入列表'}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            <div className="left-sidebar-footer">
              <button
                className="wire-btn"
                disabled={checkedTrackIds.length === 0}
                onClick={onRemoveChecked}
              >
                移除列表
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
