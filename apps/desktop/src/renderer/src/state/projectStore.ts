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

interface ProjectState {
  readonly history: History<KomaProject> | null;
  readonly file: ProjectFileInfo | null;
  /** The document as it was when it was last saved or loaded. */
  readonly savedProject: KomaProject | null;
  /** Warnings reported when the project was opened. */
  readonly loadWarnings: readonly string[];

  readonly load: (
    project: KomaProject,
    file: ProjectFileInfo | null,
    warnings?: readonly string[],
  ) => void;
  /**
   * Records a successful save. `sent` is the document that was handed to the
   * main process, `saved` the document as it was written.
   */
  readonly markSaved: (sent: KomaProject, saved: KomaProject, file: ProjectFileInfo) => void;
  /** Applies an undoable change. */
  readonly apply: (command: ProjectCommand, options?: { coalesceKey?: string }) => void;
  readonly undo: () => void;
  readonly redo: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  history: null,
  file: null,
  savedProject: null,
  loadWarnings: [],

  load(project, file, warnings = []) {
    set({
      history: createHistory(project),
      file,
      savedProject: project,
      loadWarnings: warnings,
    });
  },

  markSaved(sent, saved, file) {
    set((state) => {
      if (state.history === null) {
        return { history: createHistory(saved), file, savedProject: saved };
      }
      if (state.history.present !== sent) {
        // The document changed while it was being saved: it still has unsaved changes.
        return { file, savedProject: sent };
      }
      // Saving updates the modification time. That is not an undoable change.
      return {
        history: { ...state.history, present: saved, lastChange: null },
        file,
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
      return {
        history: commit(state.history, next, {
          coalesceKey: options.coalesceKey,
          time: Date.now(),
        }),
      };
    });
  },

  undo() {
    set((state) => (state.history === null ? state : { history: undo(state.history) }));
  },

  redo() {
    set((state) => (state.history === null ? state : { history: redo(state.history) }));
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
