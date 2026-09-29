/** New, Open, Save and Save As: the steps between the interface and the main process. */
import { selectHasUnsavedChanges, selectProject, useProjectStore } from '../state/projectStore';
import { useAgentStore } from '../state/agentStore';
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

function showProject(): void {
  useUiStore.getState().reset();
  useAgentStore.getState().clearConversation();
  const project = selectProject(useProjectStore.getState());
  useUiStore.getState().selectKoma(project?.presentation.komas[0]?.id ?? null);
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

/** Saves the project. Resolves to `true` when the project was written. */
async function save(channel: 'koma:project:save' | 'koma:project:save-as'): Promise<boolean> {
  const project = selectProject(useProjectStore.getState());
  if (project === null) {
    return false;
  }
  try {
    const response = await invoke(channel, { project });
    if (response.status === 'saved') {
      useProjectStore.getState().markSaved(project, response.project, response.file);
      useUiStore.getState().notify('info', `Saved ${response.file.fileName}`);
      return true;
    }
    if (response.status === 'failed') {
      useUiStore.getState().notify('error', response.message);
    }
    return false;
  } catch (error) {
    reportError('Saving the project', error);
    return false;
  }
}

export function saveProject(): Promise<boolean> {
  return save('koma:project:save');
}

export function saveProjectAs(): Promise<boolean> {
  return save('koma:project:save-as');
}

/** Called when the user chose "Save" while closing the window. */
export async function saveAndClose(): Promise<void> {
  if (await saveProject()) {
    await invoke('koma:app:confirm-close', {});
  }
}
