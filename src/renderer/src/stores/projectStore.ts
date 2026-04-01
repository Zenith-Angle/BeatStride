import { create } from 'zustand';
import type { AudioProbeInfo, ProjectFile, Track } from '@shared/types';
import { AUTO_SAVE_INTERVAL_MS } from '@shared/constants';
import { computeSpeedRatio } from '@shared/utils/tempo';
import {
  moveWorkspaceTrack,
  reorderWorkspaceTrack
} from '@shared/services/workspaceOrderService';
import {
  DEFAULT_EXPORT_PRESET,
  LEGACY_DEFAULT_METRONOME_SAMPLE_PATH,
  DEFAULT_METRONOME_SAMPLE_PATH,
  DEFAULT_MIX_TUNING
} from '@shared/constants';

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
  addTracksFromFiles: (
    items: Array<{
      filePath: string;
      probe: AudioProbeInfo;
      detectedBpm?: number;
      downbeatOffsetMs?: number;
    }>
  ) => void;
  addTracksFromFolder: () => Promise<void>;
  patchProject: (patch: Partial<ProjectFile>) => void;
  updateTrack: (trackId: string, patch: Partial<Track>) => void;
  removeCheckedTracks: () => void;
  removeTracksByIds: (trackIds: string[]) => void;
  toggleLibraryCheck: (trackId: string) => void;
  setAllLibraryChecked: (checked: boolean) => void;
  setLibraryCheckedIds: (ids: string[]) => void;
  setTracksWorkEnabled: (trackIds: string[], enabled: boolean) => void;
  setCheckedMedleyEnabled: (enabled: boolean) => void;
  moveTrack: (trackId: string, direction: 'up' | 'down') => void;
  reorderWorkTrack: (
    trackId: string,
    targetTrackId: string,
    placement: 'before' | 'after'
  ) => void;
  selectTimelineTrack: (trackId: string | null) => void;
  undo: () => void;
  redo: () => void;
  markClean: () => void;
  autosaveProjectFile: () => Promise<boolean>;
  autosaveRecovery: () => Promise<void>;
}

function cloneProject(project: ProjectFile): ProjectFile {
  return structuredClone(project);
}

function normalizeProject(project: ProjectFile): ProjectFile {
  const defaultMetronomeSamplePath =
    !project.defaultMetronomeSamplePath ||
    project.defaultMetronomeSamplePath === LEGACY_DEFAULT_METRONOME_SAMPLE_PATH
      ? DEFAULT_METRONOME_SAMPLE_PATH
      : project.defaultMetronomeSamplePath;
  const mixTuning = {
    ...DEFAULT_MIX_TUNING,
    ...(project.mixTuning ?? {}),
    loudnormEnabled:
      project.mixTuning?.loudnormEnabled ?? project.exportPreset?.normalizeLoudness ?? true
  };
  if (
    defaultMetronomeSamplePath === DEFAULT_METRONOME_SAMPLE_PATH &&
    mixTuning.beatRenderMode === 'crisp-click'
  ) {
    mixTuning.beatRenderMode = 'stretched-file';
  }

  return {
    ...project,
    defaultMetronomeSamplePath,
    exportPreset: {
      ...DEFAULT_EXPORT_PRESET,
      ...(project.exportPreset ?? {})
    },
    mixTuning,
    tracks: project.tracks.map((track) => ({
      ...track,
      inTimeline: Boolean(track.inTimeline || track.exportEnabled),
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
let autoSaveInFlight = false;

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
    set({
      project: normalizeProject(recovered),
      libraryCheckedIds: [],
      activeTimelineTrackId: null,
      undoStack: [],
      redoStack: [],
      dirty: true
    });
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
        detectedBpm: item.detectedBpm,
        sourceBpm: item.detectedBpm || sourceBpm,
        targetBpm: undefined,
        speedRatio: computeSpeedRatio(item.detectedBpm || sourceBpm, sourceBpm),
        downbeatOffsetMs: item.downbeatOffsetMs ?? 0,
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
    const merged = normalizeProject({
      ...state.project,
      ...patch,
      meta: { ...state.project.meta, updatedAt: new Date().toISOString() }
    });
    const targetBpmChanged =
      patch.globalTargetBpm !== undefined &&
      patch.globalTargetBpm !== state.project.globalTargetBpm;
    set({
      project: targetBpmChanged
        ? {
            ...merged,
            tracks: merged.tracks.map((track) =>
              applyTrackPatch(track, {}, merged.globalTargetBpm)
            )
          }
        : merged,
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
    get().removeTracksByIds(get().libraryCheckedIds);
  },
  removeTracksByIds: (trackIds) => {
    const state = get();
    if (!state.project || trackIds.length === 0) {
      return;
    }
    const prev = cloneProject(state.project);
    const selected = new Set(trackIds);
    const nextTracks = state.project.tracks.filter((track) => !selected.has(track.id));
    const activeStillExists = nextTracks.some((track) => track.id === state.activeTimelineTrackId);
    set({
      project: {
        ...state.project,
        tracks: nextTracks,
        meta: {
          ...state.project.meta,
          updatedAt: new Date().toISOString()
        }
      },
      libraryCheckedIds: state.libraryCheckedIds.filter((id) => !selected.has(id)),
      activeTimelineTrackId: activeStillExists ? state.activeTimelineTrackId : null,
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
  setLibraryCheckedIds: (ids) => {
    set({ libraryCheckedIds: [...new Set(ids)] });
  },
  setTracksWorkEnabled: (trackIds, enabled) => {
    const state = get();
    if (!state.project || trackIds.length === 0) {
      return;
    }

    const prev = cloneProject(state.project);
    const selected = new Set(trackIds);
    const nextTracks = state.project.tracks.map((track) => {
      if (!selected.has(track.id)) {
        return track;
      }
      return {
        ...track,
        inTimeline: enabled,
        exportEnabled: enabled
      };
    });
    const nextCheckedIds = state.libraryCheckedIds.filter((id) => !selected.has(id));
    const activeStillVisible = nextTracks.some(
      (track) => track.id === state.activeTimelineTrackId && track.exportEnabled
    );
    const nextActive =
      enabled
        ? trackIds[0] ?? state.activeTimelineTrackId
        : activeStillVisible
          ? state.activeTimelineTrackId
          : null;

    set({
      project: {
        ...state.project,
        tracks: nextTracks,
        meta: { ...state.project.meta, updatedAt: new Date().toISOString() }
      },
      libraryCheckedIds: nextCheckedIds,
      activeTimelineTrackId: nextActive,
      undoStack: [...state.undoStack, prev].slice(-50),
      redoStack: [],
      dirty: true
    });
  },
  setCheckedMedleyEnabled: (enabled) => {
    const checkedIds = get().libraryCheckedIds;
    get().setTracksWorkEnabled(checkedIds, enabled);
  },
  moveTrack: (trackId, direction) => {
    const state = get();
    if (!state.project) {
      return;
    }
    const nextTracks = moveWorkspaceTrack(state.project.tracks, trackId, direction);
    if (!nextTracks) {
      return;
    }
    const prev = cloneProject(state.project);

    set({
      project: {
        ...state.project,
        tracks: nextTracks,
        meta: { ...state.project.meta, updatedAt: new Date().toISOString() }
      },
      undoStack: [...state.undoStack, prev].slice(-50),
      redoStack: [],
      dirty: true
    });
  },
  reorderWorkTrack: (trackId, targetTrackId, placement) => {
    const state = get();
    if (!state.project || trackId === targetTrackId) {
      return;
    }
    const nextTracks = reorderWorkspaceTrack(
      state.project.tracks,
      trackId,
      targetTrackId,
      placement
    );
    if (!nextTracks) {
      return;
    }

    const prev = cloneProject(state.project);
    set({
      project: {
        ...state.project,
        tracks: nextTracks,
        meta: { ...state.project.meta, updatedAt: new Date().toISOString() }
      },
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
  autosaveProjectFile: async () => {
    const state = get();
    const project = state.project;
    const projectFilePath = project?.meta.filePath;
    if (!project || !projectFilePath) {
      return false;
    }
    const snapshotUpdatedAt = project.meta.updatedAt;

    try {
      const saved = await window.beatStride.saveProject({
        project,
        filePath: projectFilePath
      });
      if (!saved) {
        return false;
      }

      set((current) => {
        if (!current.project) {
          return {};
        }
        if (current.project.meta.updatedAt !== snapshotUpdatedAt) {
          return {
            lastSavedAt: new Date().toISOString()
          };
        }
        return {
          project: saved,
          dirty: false,
          lastSavedAt: new Date().toISOString()
        };
      });
      console.info('[BeatStride][autosave]', {
        mode: 'project-file',
        status: 'saved',
        filePath: projectFilePath
      });
      return true;
    } catch (error) {
      console.info('[BeatStride][autosave]', {
        mode: 'project-file',
        status: 'failed',
        filePath: projectFilePath,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  },
  autosaveRecovery: async () => {
    const project = get().project;
    if (!project) {
      return;
    }
    await window.beatStride.saveRecovery(project);
    console.info('[BeatStride][autosave]', {
      mode: 'recovery',
      status: 'saved'
    });
  }
}));

export function startProjectAutosave(): void {
  if (autoSaveTimer) {
    return;
  }
  autoSaveTimer = setInterval(() => {
    if (autoSaveInFlight) {
      return;
    }
    const state = useProjectStore.getState();
    if (state.project && state.dirty) {
      autoSaveInFlight = true;
      void (async () => {
        try {
          const savedProjectFile = await state.autosaveProjectFile();
          if (!savedProjectFile) {
            await state.autosaveRecovery();
            return;
          }
          await state.autosaveRecovery();
        } finally {
          autoSaveInFlight = false;
        }
      })();
    }
  }, AUTO_SAVE_INTERVAL_MS);
}

export function stopProjectAutosave(): void {
  if (!autoSaveTimer) {
    return;
  }
  clearInterval(autoSaveTimer);
  autoSaveTimer = null;
  autoSaveInFlight = false;
}
