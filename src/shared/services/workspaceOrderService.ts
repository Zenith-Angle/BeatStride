import type { Track } from '../types';

type TrackPlacement = 'before' | 'after';
type TrackMoveDirection = 'up' | 'down';

function mergeTracksWithWorkspaceOrder(
  tracks: Track[],
  orderedWorkspaceTracks: Track[]
): Track[] {
  const workspaceTrackIds = new Set(orderedWorkspaceTracks.map((track) => track.id));
  const pendingTracks = tracks.filter((track) => !workspaceTrackIds.has(track.id));
  return [...pendingTracks, ...orderedWorkspaceTracks];
}

export function getWorkspaceTracks(tracks: Track[]): Track[] {
  return tracks.filter((track) => track.exportEnabled);
}

export function moveWorkspaceTrack(
  tracks: Track[],
  trackId: string,
  direction: TrackMoveDirection
): Track[] | null {
  const workspaceTracks = getWorkspaceTracks(tracks);
  const sourceIndex = workspaceTracks.findIndex((track) => track.id === trackId);
  if (sourceIndex < 0) {
    return null;
  }

  const targetIndex = direction === 'up' ? sourceIndex - 1 : sourceIndex + 1;
  if (targetIndex < 0 || targetIndex >= workspaceTracks.length) {
    return null;
  }

  const nextWorkspaceTracks = [...workspaceTracks];
  const [moved] = nextWorkspaceTracks.splice(sourceIndex, 1);
  if (!moved) {
    return null;
  }
  nextWorkspaceTracks.splice(targetIndex, 0, moved);
  return mergeTracksWithWorkspaceOrder(tracks, nextWorkspaceTracks);
}

export function reorderWorkspaceTrack(
  tracks: Track[],
  sourceTrackId: string,
  targetTrackId: string,
  placement: TrackPlacement
): Track[] | null {
  if (sourceTrackId === targetTrackId) {
    return null;
  }

  const workspaceTracks = getWorkspaceTracks(tracks);
  const sourceIndex = workspaceTracks.findIndex((track) => track.id === sourceTrackId);
  const targetIndex = workspaceTracks.findIndex((track) => track.id === targetTrackId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return null;
  }

  const nextWorkspaceTracks = [...workspaceTracks];
  const [sourceTrack] = nextWorkspaceTracks.splice(sourceIndex, 1);
  if (!sourceTrack) {
    return null;
  }

  let insertionIndex = nextWorkspaceTracks.findIndex((track) => track.id === targetTrackId);
  if (insertionIndex < 0) {
    insertionIndex = nextWorkspaceTracks.length;
  }
  if (placement === 'after') {
    insertionIndex += 1;
  }

  nextWorkspaceTracks.splice(
    Math.max(0, Math.min(insertionIndex, nextWorkspaceTracks.length)),
    0,
    sourceTrack
  );
  return mergeTracksWithWorkspaceOrder(tracks, nextWorkspaceTracks);
}
