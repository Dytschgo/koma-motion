/** New, Open, Save and Save As: the steps between the interface and the main process. */
import { setBrandLogo } from '@koma-motion/core';
import { serialiseProject } from '@koma-motion/project-format';
import { useAgentStore } from '../state/agentStore';
import {
  selectHasUnsavedChanges,
  selectProject,
  useProjectStore,
  type SaveClaim,
} from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { invoke } from './api';

export const DEFAULT_PROJECT_NAME = 'Untitled project';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

function reportError(action: string, error: unknown): void {
  useUiStore.getState().notify('error', `${action} failed. ${describeError(error)}`);
}

/**
 * Asks before an action replaces a project with unsaved changes. Resolves to
 * `true` when the action may continue.
 */
async function confirmReplacingProject(action: string): Promise<boolean> {
  if (!selectHasUnsavedChanges(useProjectStore.getState())) {
    return true;
  }
  return useUiStore.getState().confirm({
    title: 'Discard unsaved changes?',
    message: `This project has changes that are not saved. ${action} discards them.`,
    confirmLabel: 'Discard changes',
    cancelLabel: 'Keep editing',
    destructive: true,
  });
}

/**
 * Drops a generation that belonged to the project being replaced. Its result
 * is also ignored, because the project session changes when the new one loads.
 */
function detachGeneration(): void {
  const execution = useAgentStore.getState().execution;
  if (execution === null) {
    return;
  }
  const { executionId } = execution;
  useAgentStore.getState().finishExecution(executionId);
  void invoke('koma:providers:cancel', { executionId }).catch(() => undefined);
}

function showProject(): void {
  detachGeneration();
  useUiStore.getState().reset();
  useAgentStore.getState().clearConversation();
  const project = selectProject(useProjectStore.getState());
  useUiStore.getState().selectKoma(project?.presentation.komas[0]?.id ?? null);
}

function isCurrentSession(sessionId: number): boolean {
  return useProjectStore.getState().sessionId === sessionId;
}

export async function createNewProject(): Promise<void> {
  if (!(await confirmReplacingProject('Creating a new project'))) {
    return;
  }
  try {
    const { project } = await invoke('koma:project:create', { name: DEFAULT_PROJECT_NAME });
    useProjectStore.getState().load(project, null);
    showProject();
  } catch (error) {
    reportError('Creating the project', error);
  }
}

export async function openProject(): Promise<void> {
  if (!(await confirmReplacingProject('Opening another project'))) {
    return;
  }
  try {
    const response = await invoke('koma:project:open', {});
    if (response.status === 'opened') {
      useProjectStore.getState().load(response.project, response.file, response.warnings);
      showProject();
    } else if (response.status === 'failed') {
      useUiStore.getState().notify('error', response.message);
    }
  } catch (error) {
    reportError('Opening the project', error);
  }
}

/**
 * Saves the snapshot that is current when the save starts.
 *
 * Resolves to `true` only when that snapshot is still the open project and
 * the document has no newer unsaved edits. An older save that finishes after
 * a newer one does not change the path or the saved-state marker, and a save
 * that finishes after the project was replaced is ignored.
 */
async function save(channel: 'koma:project:save' | 'koma:project:save-as'): Promise<boolean> {
  const project = selectProject(useProjectStore.getState());
  const claim = useProjectStore.getState().claimSave();
  if (project === null || claim === null) {
    return false;
  }
  try {
    const response = await invoke(channel, { project });
    if (!isCurrentSession(claim.sessionId)) {
      return false;
    }
    if (response.status === 'saved') {
      useProjectStore.getState().markSaved(project, response.project, response.file, claim);
      if (!didAcceptSave(claim)) {
        return false;
      }
      useUiStore.getState().notify('info', `Saved ${response.file.fileName}`);
      return !selectHasUnsavedChanges(useProjectStore.getState());
    }
    if (response.status === 'failed') {
      useUiStore.getState().notify('error', response.message);
    }
    return false;
  } catch (error) {
    if (isCurrentSession(claim.sessionId)) {
      reportError('Saving the project', error);
    }
    return false;
  }
}

/** True when this save is still the newest one applied to its project session. */
function didAcceptSave(claim: SaveClaim): boolean {
  const state = useProjectStore.getState();
  return state.sessionId === claim.sessionId && state.appliedSaveSerial === claim.serial;
}

export function saveProject(): Promise<boolean> {
  return save('koma:project:save');
}

export function saveProjectAs(): Promise<boolean> {
  return save('koma:project:save-as');
}

/**
 * Called when the user chose "Save" while closing the window.
 *
 * The window closes only when the saved snapshot is still the current
 * document of the same project. Edits made while the save was running stay
 * open. Cancelling the save dialog also leaves the window open.
 */
export async function saveAndClose(): Promise<void> {
  const sessionId = useProjectStore.getState().sessionId;
  const savedCurrentRevision = await saveProject();
  if (
    !savedCurrentRevision ||
    !isCurrentSession(sessionId) ||
    selectHasUnsavedChanges(useProjectStore.getState())
  ) {
    return;
  }
  await invoke('koma:app:set-unsaved-changes', { hasUnsavedChanges: false });
  if (!isCurrentSession(sessionId) || selectHasUnsavedChanges(useProjectStore.getState())) {
    return;
  }
  await invoke('koma:app:confirm-close', {});
}

/**
 * Adds a logo chosen in the native dialog. The image is applied only when
 * the same project is still open: a dialog that outlives a project switch
 * must not attach the image to the replacement.
 */
export async function chooseProjectLogo(): Promise<void> {
  const sessionId = useProjectStore.getState().sessionId;
  if (sessionId === 0) {
    return;
  }
  try {
    const response = await invoke('koma:brand-kit:select-logo', {});
    if (!isCurrentSession(sessionId)) {
      return;
    }
    if (response.status === 'selected') {
      const project = selectProject(useProjectStore.getState());
      if (project === null) {
        return;
      }
      const updated = setBrandLogo(project, response.asset);
      const serialised = serialiseProject(updated);
      if (!serialised.ok) {
        const suggestion =
          serialised.error.code === 'tooLarge'
            ? ' Remove an unused image before adding a new logo.'
            : '';
        throw new Error(`${serialised.error.message}${suggestion}`);
      }
      useProjectStore.getState().apply(() => updated);
    } else if (response.status === 'failed') {
      useUiStore.getState().notify('error', response.message);
    }
  } catch (error) {
    if (isCurrentSession(sessionId)) {
      reportError('Adding the logo', error);
    }
  }
}
