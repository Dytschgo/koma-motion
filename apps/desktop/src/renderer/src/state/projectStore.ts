/**
 * Persisted project state: the document, its undo history and whether it has
 * unsaved changes. Temporary interface state lives in `uiStore`, the state of
 * agent executions in `agentStore`.
 */
import { createRandomIdGenerator, type KomaProject } from '@koma-motion/core';
import { create } from 'zustand';
import type { ProjectFileInfo } from '../../../shared/ipc';
import type { ProjectCommand } from './commands';
import { canRedo, canUndo, commit, createHistory, redo, undo, type History } from './history';

const idGenerator = createRandomIdGenerator();

/** Identifies one save request so an older response cannot overwrite a newer one. */
export interface SaveClaim {
  readonly sessionId: number;
  readonly serial: number;
}

interface ProjectState {
  readonly history: History<KomaProject> | null;
  readonly file: ProjectFileInfo | null;
  /** The document as it was when it was last saved or loaded. */
  readonly savedProject: KomaProject | null;
  /** Warnings reported when the project was opened. */
  readonly loadWarnings: readonly string[];
  /**
   * Identity of the project open in this window. It changes when that project
   * is replaced, so a result from the previous project can be recognised.
   */
  readonly sessionId: number;
  /** Next serial to give a save. Serials only grow, including across projects. */
  readonly nextSaveSerial: number;
  /** Highest save response that has been applied to the current session. */
  readonly appliedSaveSerial: number;

  readonly load: (
    project: KomaProject,
    file: ProjectFileInfo | null,
    warnings?: readonly string[],
  ) => void;
  /**
   * Reserves a serial for a save of the project that is open now.
   * Returns null when no project is open.
   */
  readonly claimSave: () => SaveClaim | null;
  /**
   * Records a successful save. `sent` is the document that was handed to the
   * main process, `saved` the document as it was written. A response from
   * another session, or an older response for this session, is ignored.
   */
  readonly markSaved: (
    sent: KomaProject,
    saved: KomaProject,
    file: ProjectFileInfo,
    claim: SaveClaim,
  ) => void;
  /** Applies an undoable change. */
  readonly apply: (command: ProjectCommand, options?: { coalesceKey?: string }) => void;
  readonly undo: () => void;
  readonly redo: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  history: null,
  file: null,
  savedProject: null,
  loadWarnings: [],
  sessionId: 0,
  nextSaveSerial: 1,
  appliedSaveSerial: 0,

  load(project, file, warnings = []) {
    set((state) => ({
      history: createHistory(project),
      file,
      savedProject: project,
      loadWarnings: warnings,
      sessionId: state.sessionId + 1,
      appliedSaveSerial: 0,
    }));
  },

  claimSave() {
    const state = get();
    if (state.history === null) {
      return null;
    }
    const claim = { sessionId: state.sessionId, serial: state.nextSaveSerial };
    set({ nextSaveSerial: state.nextSaveSerial + 1 });
    return claim;
  },

  markSaved(sent, saved, file, claim) {
    set((state) => {
      if (
        state.history === null ||
        state.sessionId !== claim.sessionId ||
        claim.serial < state.appliedSaveSerial
      ) {
        return state;
      }
      const accepted = { file, appliedSaveSerial: claim.serial };
      if (state.history.present !== sent) {
        // The document changed while it was being saved: it still has unsaved changes.
        return { ...accepted, savedProject: sent };
      }
      // Saving updates the modification time. That is not an undoable change.
      return {
        ...accepted,
        history: { ...state.history, present: saved, lastChange: null },
        savedProject: saved,
      };
    });
  },

  apply(command, options = {}) {
    set((state) => {
      if (state.history === null) {
        return state;
      }
      const next = command(state.history.present, idGenerator);
      const history = commit(state.history, next, {
        coalesceKey: options.coalesceKey,
        time: Date.now(),
      });
      return history === state.history ? state : { history };
    });
  },

  undo() {
    set((state) => {
      if (state.history === null) {
        return state;
      }
      const history = undo(state.history);
      return history === state.history ? state : { history };
    });
  },

  redo() {
    set((state) => {
      if (state.history === null) {
        return state;
      }
      const history = redo(state.history);
      return history === state.history ? state : { history };
    });
  },
}));

export const selectProject = (state: ProjectState): KomaProject | null =>
  state.history?.present ?? null;

export const selectHasUnsavedChanges = (state: ProjectState): boolean =>
  state.history !== null && state.history.present !== state.savedProject;

export const selectCanUndo = (state: ProjectState): boolean =>
  state.history !== null && canUndo(state.history);

export const selectCanRedo = (state: ProjectState): boolean =>
  state.history !== null && canRedo(state.history);
