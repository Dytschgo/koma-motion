/** New, Open, Save and Save As: the steps between the interface and the main process. */
import type { StarterPreset } from '@koma-motion/brand-kit';
import { setBrandLogo, type KomaProject, type IdGenerator } from '@koma-motion/core';
import { serialiseProject } from '@koma-motion/project-format';
import { addKoma, applyStarterPreset, importImage } from '../state/commands';
import { useAgentStore } from '../state/agentStore';
import {
  selectHasUnsavedChanges,
  selectProject,
  useProjectStore,
  type SaveClaim,
} from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { useHealthStore } from '../state/healthStore';
import { useReferenceStore } from '../state/referenceStore';
import { useBrandProfileStore } from '../state/brandProfileStore';
import { invoke } from './api';
import { flushRecovery } from './recovery';

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
  useAgentStore.getState().finishExecution(executionId, 'cancelled');
  void invoke('koma:providers:cancel', { executionId }).catch(() => undefined);
}

function showProject(): void {
  useReferenceStore.getState().clear();
  // The main process discards the draft of a replaced project as well.
  useBrandProfileStore.getState().clear();
  useHealthStore.getState().clearFailure();
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
    const { project, recoverySessionId } = await invoke('koma:project:create', {
      name: DEFAULT_PROJECT_NAME,
    });
    useProjectStore.getState().load(project, null, [], null, [], recoverySessionId);
    showProject();
  } catch (error) {
    reportError('Creating the project', error);
  }
}

/** Puts the first request of a starter into the chat and shows the chat. */
function seedStarterRequest(preset: StarterPreset): void {
  const ui = useUiStore.getState();
  ui.seedComposer({ request: preset.request, komaCount: preset.komaCount });
  ui.setAgentPanelOpen(true);
}

/**
 * Creates a project that already has the Brand Kit and instructions of a
 * starter, and puts its first request into the chat, ready to send.
 */
export async function createProjectFromStarter(preset: StarterPreset): Promise<void> {
  if (!(await confirmReplacingProject('Creating a new project'))) {
    return;
  }
  try {
    const { project, recoverySessionId } = await invoke('koma:project:create', {
      name: preset.name,
    });
    // A new project has no logo, so the starter kit replaces its kit as a whole.
    useProjectStore.getState().load(
      {
        ...project,
        brandKit: { ...preset.brandKit, logoAssetId: null },
        systemInstructions: preset.systemInstructions,
      },
      null,
      [],
      null,
      [],
      recoverySessionId,
      true,
    );
    showProject();
    seedStarterRequest(preset);
  } catch (error) {
    reportError('Creating the project', error);
  }
}

/** Applies a starter to the open project as one undoable change. */
export function applyStarterToProject(preset: StarterPreset): void {
  try {
    useProjectStore.getState().apply(applyStarterPreset(preset));
    seedStarterRequest(preset);
  } catch (error) {
    reportError('Applying the starter', error);
  }
}

export async function openProject(): Promise<void> {
  if (!(await confirmReplacingProject('Opening another project'))) {
    return;
  }
  try {
    const response = await invoke('koma:project:open', {});
    if (response.status === 'opened') {
      useProjectStore
        .getState()
        .load(
          response.project,
          response.file,
          response.warnings,
          response.migratedFrom ?? null,
          response.unavailableAssetIds ?? [],
          response.recoverySessionId,
        );
      showProject();
      if (response.migratedFrom != null) useHealthStore.getState().setOpen(true);
    } else if (response.status === 'failed') {
      useHealthStore.getState().failOpen({
        message: response.message,
        diagnostics: response.diagnostics ?? response.message,
      });
    }
  } catch (error) {
    useHealthStore.getState().failOpen({
      message:
        'The project could not be opened. Your current project is still available. Try opening the file again.',
      diagnostics: describeError(error),
    });
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
async function save(
  channel: 'koma:project:save' | 'koma:project:save-as',
  preserveOriginal = false,
  onFailure?: (message: string) => void,
): Promise<boolean> {
  const project = selectProject(useProjectStore.getState());
  const claim = useProjectStore.getState().claimSave();
  if (project === null || claim === null) {
    return false;
  }
  try {
    const response = await invoke(channel, {
      project,
      ...(preserveOriginal ? { preserveOriginal: true } : {}),
    });
    if (!isCurrentSession(claim.sessionId)) {
      return false;
    }
    if (response.status === 'saved') {
      useProjectStore.getState().markSaved(project, response.project, response.file, claim);
      if (!didAcceptSave(claim)) {
        return false;
      }
      await flushRecovery();
      useUiStore.getState().notify('info', `Saved ${response.file.fileName}`);
      return !selectHasUnsavedChanges(useProjectStore.getState());
    }
    if (response.status === 'failed') {
      if (onFailure) onFailure(response.message);
      else useUiStore.getState().notify('error', response.message);
    }
    return false;
  } catch (error) {
    if (isCurrentSession(claim.sessionId)) {
      if (onFailure) onFailure(`Saving the project failed. ${describeError(error)}`);
      else reportError('Saving the project', error);
    }
    return false;
  }
}

/** True when this save is still the newest one applied to its project session. */
function didAcceptSave(claim: SaveClaim): boolean {
  const state = useProjectStore.getState();
  return state.sessionId === claim.sessionId && state.appliedSaveSerial === claim.serial;
}

export function saveProject(onFailure?: (message: string) => void): Promise<boolean> {
  return save('koma:project:save', false, onFailure);
}

export function saveProjectAs(): Promise<boolean> {
  return save('koma:project:save-as');
}

export function saveProjectCopy(onFailure?: (message: string) => void): Promise<boolean> {
  return save('koma:project:save-as', true, onFailure);
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

/** Native file selection is bound to this session and Koma, including across async dialogs. */
export async function chooseKomaImage(komaId: string, elementId?: string): Promise<void> {
  const { sessionId } = useProjectStore.getState();
  if (useUiStore.getState().preview !== null) return;
  try {
    const response = await invoke('koma:project:select-image', {});
    if (
      !isCurrentSession(sessionId) ||
      useUiStore.getState().preview !== null ||
      useUiStore.getState().selectedKomaId !== komaId
    )
      return;
    if (response.status === 'failed') {
      useUiStore.getState().notify('error', response.message);
      return;
    }
    if (response.status !== 'selected') return;
    // Validate the total project size before committing any document or history change.
    const command = importImage(komaId, response.asset, elementId);
    useProjectStore.getState().apply(
      Object.assign(
        (project: KomaProject, ids: IdGenerator) => {
          const next = command(project, ids);
          const result = serialiseProject(next);
          if (!result.ok) throw new Error(result.error.message);
          return next;
        },
        { affectedKomaIds: command.affectedKomaIds },
      ),
    );
    const project = selectProject(useProjectStore.getState());
    const image = project?.presentation.komas
      .find((koma) => koma.id === komaId)
      ?.elements.find(
        (item) => item.type === 'image' && item.content.assetId === response.asset.id,
      );
    if (image) useUiStore.getState().selectElement(image.id);
  } catch (error) {
    if (isCurrentSession(sessionId)) reportError('Importing the image', error);
  }
}

/** Adds a Koma after `afterKomaId`, or an empty one at the end, and selects it. */
export function addKomaAfter(afterKomaId: string | null): void {
  const known = new Set(
    selectProject(useProjectStore.getState())?.presentation.komas.map((koma) => koma.id),
  );
  useProjectStore.getState().apply(addKoma(afterKomaId));
  const added = selectProject(useProjectStore.getState())?.presentation.komas.find(
    (koma) => !known.has(koma.id),
  );
  if (added !== undefined) {
    useUiStore.getState().selectKoma(added.id);
  }
}

/** Restoration never adopts a disk path or a clean saved marker. */
export async function recoverProject(): Promise<void> {
  const response = await invoke('koma:recovery:restore', {});
  if (response.status === 'failed') throw new Error(response.message);
  useProjectStore
    .getState()
    .load(
      response.project,
      null,
      [],
      null,
      response.unavailableAssetIds,
      response.recoverySessionId,
      true,
    );
  showProject();
}
