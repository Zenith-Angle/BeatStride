import { create } from 'zustand';
import type { AudioProbeInfo, ProjectFile, Track } from '@shared/types';
import { AUTO_SAVE_INTERVAL_MS } from '@shared/constants';
import { computeSpeedRatio } from '@shared/utils/tempo';

interface ProjectState {
  project: ProjectFile | null;
  libraryCheckedIds: string[];
  activeTimelineTrackId: string | null;
  undoStack: ProjectFile[];
  redoStack: ProjectFile[];
  dirty: boolean;
  lastSavedAt?: string;
  setProject: (project: ProjectFile | null) => void;
  createProject: () => Promise<void>;
  openProject: () => Promise<void>;
  openProjectByPath: (filePath: string) => Promise<void>;
  saveProject: () => Promise<void>;
  saveProjectAs: () => Promise<void>;
  loadRecovery: () => Promise<void>;
  addTracksFromFiles: (items: Array<{ filePath: string; probe: AudioProbeInfo }>) => void;
  addTracksFromFolder: () => Promise<void>;
  patchProject: (patch: Partial<ProjectFile>) => void;
  updateTrack: (trackId: string, patch: Partial<Track>) => void;
  removeCheckedTracks: () => void;
  toggleLibraryCheck: (trackId: string) => void;
  setAllLibraryChecked: (checked: boolean) => void;
  addCheckedToTimeline: () => void;
  selectTimelineTrack: (trackId: string | null) => void;
  undo: () => void;
  redo: () => void;
  markClean: () => void;
  autosaveRecovery: () => Promise<void>;
}

function cloneProject(project: ProjectFile): ProjectFile {
  return structuredClone(project);
}

function normalizeProject(project: ProjectFile): ProjectFile {
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      inTimeline: Boolean(track.inTimeline),
      exportEnabled: Boolean(track.exportEnabled)
    }))
  };
}

function applyTrackPatch(track: Track, patch: Partial<Track>, globalTargetBpm: number): Track {
  const next = { ...track, ...patch };
  const target = next.targetBpm ?? globalTargetBpm;
  const source = next.sourceBpm || target;
  return {
    ...next,
    speedRatio: computeSpeedRatio(source, target)
  };
}

let autoSaveTimer: ReturnType<typeof setInterval> | null = null;

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  libraryCheckedIds: [],
  activeTimelineTrackId: null,
  undoStack: [],
  redoStack: [],
  dirty: false,
  setProject: (project) => {
    set({
      project: project ? normalizeProject(project) : null,
      libraryCheckedIds: [],
      activeTimelineTrackId: null,
      undoStack: [],
      redoStack: [],
      dirty: false
    });
  },
  createProject: async () => {
    const project = await window.beatStride.createNewProject();
    if (!project) {
      return;
    }
    set({
      project: normalizeProject(project),
      libraryCheckedIds: [],
      activeTimelineTrackId: null,
      undoStack: [],
      redoStack: [],
      dirty: false
    });
  },
  openProject: async () => {
    const project = await window.beatStride.openProject();
    if (!project) {
      return;
    }
    set({
      project: normalizeProject(project),
      libraryCheckedIds: [],
      activeTimelineTrackId: null,
      undoStack: [],
      redoStack: [],
      dirty: false
    });
  },
  openProjectByPath: async (filePath) => {
    const project = await window.beatStride.openProjectByPath(filePath);
    if (!project) {
      return;
    }
    set({
      project: normalizeProject(project),
      libraryCheckedIds: [],
      activeTimelineTrackId: null,
      undoStack: [],
      redoStack: [],
      dirty: false
    });
  },
  saveProject: async () => {
    const state = get();
    if (!state.project) {
      return;
    }
    const saved = await window.beatStride.saveProject({ project: state.project });
    if (!saved) {
      return;
    }
    set({ project: saved, dirty: false, lastSavedAt: new Date().toISOString() });
  },
  saveProjectAs: async () => {
    const state = get();
    if (!state.project) {
      return;
    }
    const saved = await window.beatStride.saveProjectAs({ project: state.project });
    if (!saved) {
      return;
    }
    set({ project: saved, dirty: false, lastSavedAt: new Date().toISOString() });
  },
  loadRecovery: async () => {
    const recovered = await window.beatStride.loadRecovery();
    if (!recovered) {
      return;
    }
    set({ project: normalizeProject(recovered), dirty: true });
  },
  addTracksFromFiles: (items) => {
    const state = get();
    if (!state.project || items.length === 0) {
      return;
    }
    const prev = cloneProject(state.project);
    const tracks: Track[] = items.map((item, index) => {
      const baseName = item.filePath.split(/[\\/]/).pop() ?? `Track_${index}`;
      const sourceBpm = state.project?.globalTargetBpm ?? 180;
      return {
        id: crypto.randomUUID(),
        name: baseName,
        filePath: item.filePath,
        durationMs: item.probe.durationMs,
        sampleRate: item.probe.sampleRate,
        channels: item.probe.channels,
        detectedBpm: undefined,
        sourceBpm,
        targetBpm: undefined,
        speedRatio: 1,
        downbeatOffsetMs: 0,
        metronomeOffsetMs: 0,
        trackStartMs: 0,
        trimInMs: 0,
        trimOutMs: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        volumeDb: 0,
        pan: 0,
        metronomeEnabled: true,
        metronomeVolumeDb: -8,
        exportEnabled: false,
        inTimeline: false
      };
    });
    const next: ProjectFile = {
      ...state.project,
      tracks: [...state.project.tracks, ...tracks],
      meta: {
        ...state.project.meta,
        updatedAt: new Date().toISOString()
      }
    };
    set({
      project: next,
      undoStack: [...state.undoStack, prev].slice(-50),
      redoStack: [],
      dirty: true
    });
  },
  addTracksFromFolder: async () => {
    const filePaths = await window.beatStride.selectAudioFolder();
    if (filePaths.length === 0) {
      return;
    }
    const probed = await Promise.all(
      filePaths.map(async (filePath) => ({
        filePath,
        probe: await window.beatStride.probeAudio(filePath)
      }))
    );
    get().addTracksFromFiles(probed);
  },
  patchProject: (patch) => {
    const state = get();
    if (!state.project) {
      return;
    }
    const prev = cloneProject(state.project);
    set({
      project: {
        ...state.project,
        ...patch,
        meta: { ...state.project.meta, updatedAt: new Date().toISOString() }
      },
      undoStack: [...state.undoStack, prev].slice(-50),
      redoStack: [],
      dirty: true
    });
  },
  updateTrack: (trackId, patch) => {
    const state = get();
    if (!state.project) {
      return;
    }
    const project = state.project;
    const prev = cloneProject(project);
    const next: ProjectFile = {
      ...project,
      tracks: project.tracks.map((track) =>
        track.id === trackId
          ? applyTrackPatch(track, patch, project.globalTargetBpm)
          : track
      ),
      meta: {
        ...project.meta,
        updatedAt: new Date().toISOString()
      }
    };
    set({
      project: next,
      undoStack: [...state.undoStack, prev].slice(-50),
      redoStack: [],
      dirty: true
    });
  },
  removeCheckedTracks: () => {
    const state = get();
    if (!state.project || state.libraryCheckedIds.length === 0) {
      return;
    }
    const prev = cloneProject(state.project);
    const selected = new Set(state.libraryCheckedIds);
    const next: ProjectFile = {
      ...state.project,
      tracks: state.project.tracks.filter((track) => !selected.has(track.id)),
      meta: {
        ...state.project.meta,
        updatedAt: new Date().toISOString()
      }
    };
    set({
      project: next,
      libraryCheckedIds: [],
      activeTimelineTrackId: null,
      undoStack: [...state.undoStack, prev].slice(-50),
      redoStack: [],
      dirty: true
    });
  },
  toggleLibraryCheck: (trackId) => {
    const checked = get().libraryCheckedIds;
    if (checked.includes(trackId)) {
      set({ libraryCheckedIds: checked.filter((id) => id !== trackId) });
      return;
    }
    set({ libraryCheckedIds: [...checked, trackId] });
  },
  setAllLibraryChecked: (checked) => {
    const project = get().project;
    if (!project) {
      return;
    }
    set({ libraryCheckedIds: checked ? project.tracks.map((track) => track.id) : [] });
  },
  addCheckedToTimeline: () => {
    const state = get();
    if (!state.project || state.libraryCheckedIds.length === 0) {
      return;
    }

    const prev = cloneProject(state.project);
    let cursor = 0;
    const timelineTracks = state.project.tracks
      .filter((track) => track.inTimeline)
      .sort((a, b) => a.trackStartMs - b.trackStartMs);
    for (const track of timelineTracks) {
      cursor = Math.max(cursor, track.trackStartMs + track.durationMs);
    }

    const selected = new Set(state.libraryCheckedIds);
    const nextTracks = state.project.tracks.map((track) => {
      if (!selected.has(track.id) || track.inTimeline) {
        return track;
      }
      const next: Track = {
        ...track,
        inTimeline: true,
        exportEnabled: true,
        trackStartMs: cursor
      };
      cursor += track.durationMs;
      return next;
    });

    const activeTrack = nextTracks.find((track) => selected.has(track.id) && track.inTimeline);

    set({
      project: {
        ...state.project,
        tracks: nextTracks,
        meta: { ...state.project.meta, updatedAt: new Date().toISOString() }
      },
      activeTimelineTrackId: activeTrack?.id ?? state.activeTimelineTrackId,
      undoStack: [...state.undoStack, prev].slice(-50),
      redoStack: [],
      dirty: true
    });
  },
  selectTimelineTrack: (trackId) => {
    set({ activeTimelineTrackId: trackId });
  },
  undo: () => {
    const state = get();
    const previous = state.undoStack.at(-1);
    if (!previous || !state.project) {
      return;
    }
    const rest = state.undoStack.slice(0, -1);
    set({
      project: previous,
      undoStack: rest,
      redoStack: [...state.redoStack, cloneProject(state.project)].slice(-50),
      dirty: true
    });
  },
  redo: () => {
    const state = get();
    const next = state.redoStack.at(-1);
    if (!next || !state.project) {
      return;
    }
    const rest = state.redoStack.slice(0, -1);
    set({
      project: next,
      undoStack: [...state.undoStack, cloneProject(state.project)].slice(-50),
      redoStack: rest,
      dirty: true
    });
  },
  markClean: () => set({ dirty: false }),
  autosaveRecovery: async () => {
    const project = get().project;
    if (!project) {
      return;
    }
    await window.beatStride.saveRecovery(project);
  }
}));

export function startProjectAutosave(): void {
  if (autoSaveTimer) {
    return;
  }
  autoSaveTimer = setInterval(() => {
    const state = useProjectStore.getState();
    if (state.project && state.dirty) {
      void state.autosaveRecovery();
    }
  }, AUTO_SAVE_INTERVAL_MS);
}

export function stopProjectAutosave(): void {
  if (!autoSaveTimer) {
    return;
  }
  clearInterval(autoSaveTimer);
  autoSaveTimer = null;
}
