/**
 * The steps between the Brand Kit library in the interface and the main
 * process. Library changes are not project changes: they are not undoable
 * and do not mark the project as changed. Applying a saved kit is a project
 * change and goes through the undo history like any other edit.
 */
import {
  createDefaultBrandKit,
  getProjectLogoData,
  validateBrandKitDraft,
  withBrandKitRawDraft,
} from '@koma-motion/brand-kit';
import { createRandomIdGenerator } from '@koma-motion/core';
import { serialiseProject } from '@koma-motion/project-format';
import type { BrandKitLibraryState } from '../../../shared/ipc';
import { useBrandKitLibraryStore } from '../state/brandKitLibraryStore';
import { applySavedBrandKit } from '../state/commands';
import { selectProject, useProjectStore } from '../state/projectStore';
import { selectBrandKitRawDraft, useUiStore } from '../state/uiStore';
import { invoke } from './api';

const idGenerator = createRandomIdGenerator();

function notify(kind: 'error' | 'info', message: string): void {
  useUiStore.getState().notify(kind, message);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

/** True when the editor holds text that could not be stored in the project. */
function hasInvalidDraft(): boolean {
  const project = selectProject(useProjectStore.getState());
  if (project === null) {
    return false;
  }
  const raw = selectBrandKitRawDraft(useUiStore.getState(), project.id);
  return !validateBrandKitDraft(withBrandKitRawDraft(project.brandKit, raw)).ok;
}

/**
 * Runs one library request. The library view follows the reported state; a
 * failed action keeps the list the user sees and explains what happened.
 * Resolves to the state, or null when the request itself failed.
 */
async function run(
  request: () => Promise<BrandKitLibraryState>,
  failure: string,
): Promise<BrandKitLibraryState | null> {
  const store = useBrandKitLibraryStore.getState();
  store.setBusy(true);
  try {
    const state = await request();
    if (state.status === 'failed') {
      notify('error', state.message);
    } else {
      useBrandKitLibraryStore.getState().receive(state);
    }
    return state;
  } catch (error) {
    notify('error', `${failure} ${describeError(error)}`);
    return null;
  } finally {
    useBrandKitLibraryStore.getState().setBusy(false);
  }
}

export async function loadBrandKitLibrary(): Promise<void> {
  const store = useBrandKitLibraryStore.getState();
  store.setBusy(true);
  try {
    store.receive(await invoke('koma:brand-kits:list', {}));
  } catch (error) {
    store.fail(`The Brand Kit library could not be loaded. ${describeError(error)}`);
  } finally {
    useBrandKitLibraryStore.getState().setBusy(false);
  }
}

/** Saves the Brand Kit of the open project, logo included, as a new library entry. */
export async function saveProjectBrandKit(): Promise<void> {
  const project = selectProject(useProjectStore.getState());
  if (project === null) {
    return;
  }
  const name = project.brandKit.name.trim() === '' ? 'Untitled brand' : project.brandKit.name;
  const invalid = hasInvalidDraft();
  const logo = getProjectLogoData(project);
  const state = await run(
    () => invoke('koma:brand-kits:create', { name, brandKit: project.brandKit, logo }),
    'Saving the Brand Kit failed.',
  );
  if (state?.status === 'ready') {
    notify(
      'info',
      `Saved "${name}" to your Brand Kit library.${
        invalid ? ' Fields marked with an error were saved with their last valid value.' : ''
      }`,
    );
    if (logo === null && project.brandKit.logoAssetId !== null) {
      notify('error', 'The logo of this project has no image data, so it was not saved.');
    }
  }
}

/** Adds a kit with the default settings and no logo. */
export async function createBlankBrandKit(): Promise<void> {
  const brandKit = createDefaultBrandKit();
  const state = await run(
    () => invoke('koma:brand-kits:create', { name: 'New Brand Kit', brandKit, logo: null }),
    'Creating the Brand Kit failed.',
  );
  if (state?.status === 'ready') {
    notify('info', 'Added "New Brand Kit". Apply it to this project to edit it.');
  }
}

/** Resolves to true when the name was stored. */
export async function renameSavedBrandKit(id: string, name: string): Promise<boolean> {
  const state = await run(
    () => invoke('koma:brand-kits:rename', { id, name }),
    'Renaming the Brand Kit failed.',
  );
  return state?.status === 'ready';
}

export async function duplicateSavedBrandKit(id: string): Promise<void> {
  await run(() => invoke('koma:brand-kits:duplicate', { id }), 'Duplicating the Brand Kit failed.');
}

/** Replaces a saved kit with the Brand Kit of the open project, after asking. */
export async function updateSavedBrandKit(id: string, name: string): Promise<void> {
  const project = selectProject(useProjectStore.getState());
  if (project === null) {
    return;
  }
  const confirmed = await useUiStore.getState().confirm({
    title: `Update "${name}"?`,
    message:
      "The saved Brand Kit is replaced with this project's colours, fonts, logo and descriptions. Projects that already use it keep their own copy. This cannot be undone.",
    confirmLabel: 'Update saved kit',
    cancelLabel: 'Keep it as it is',
    destructive: true,
  });
  if (!confirmed) {
    return;
  }
  const current = selectProject(useProjectStore.getState()) ?? project;
  const state = await run(
    () =>
      invoke('koma:brand-kits:update', {
        id,
        brandKit: current.brandKit,
        logo: getProjectLogoData(current),
      }),
    'Updating the Brand Kit failed.',
  );
  if (state?.status === 'ready') {
    notify('info', `Updated "${name}" in your Brand Kit library.`);
  }
}

export async function deleteSavedBrandKit(id: string, name: string): Promise<void> {
  const confirmed = await useUiStore.getState().confirm({
    title: `Delete "${name}"?`,
    message:
      'The saved Brand Kit and its logo are removed from the library on this computer. Projects that use it keep their own copy. This cannot be undone.',
    confirmLabel: 'Delete saved kit',
    cancelLabel: 'Keep it',
    destructive: true,
  });
  if (!confirmed) {
    return;
  }
  const state = await run(
    () => invoke('koma:brand-kits:delete', { id }),
    'Deleting the Brand Kit failed.',
  );
  if (state?.status === 'ready') {
    notify('info', `Deleted "${name}" from your Brand Kit library.`);
  }
}

/**
 * Makes a saved kit the Brand Kit of the open project. This is one undoable
 * project change. A reply that arrives after the project was replaced is
 * ignored, so the kit never lands in a different project.
 */
export async function applySavedBrandKitToProject(id: string): Promise<void> {
  const { sessionId } = useProjectStore.getState();
  if (selectProject(useProjectStore.getState()) === null) {
    return;
  }
  if (hasInvalidDraft()) {
    const confirmed = await useUiStore.getState().confirm({
      title: 'Replace the fields with errors?',
      message:
        'Some Brand Kit fields contain text that is not valid and was never stored. Applying the saved kit replaces that text.',
      confirmLabel: 'Apply saved kit',
      cancelLabel: 'Keep editing',
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
  }

  const store = useBrandKitLibraryStore.getState();
  store.setBusy(true);
  try {
    const response = await invoke('koma:brand-kits:load', { id });
    const project = selectProject(useProjectStore.getState());
    if (useProjectStore.getState().sessionId !== sessionId || project === null) {
      return;
    }
    if (response.status === 'failed') {
      notify('error', response.message);
      return;
    }
    const { kit, logo, logoProblem } = response;
    const updated = applySavedBrandKit(kit.brandKit, logo)(project, idGenerator);
    if (updated === project) {
      notify('info', `This project already uses "${kit.name}".`);
      return;
    }
    const serialised = serialiseProject(updated);
    if (!serialised.ok) {
      throw new Error(serialised.error.message);
    }
    // The editor shows the applied kit, not text typed for the previous one.
    useUiStore.getState().setBrandKitDraft(project.id, {});
    useProjectStore.getState().apply(() => updated);
    notify('info', `Applied "${kit.name}" to this project. Use Undo to go back.`);
    if (logoProblem !== null) {
      notify('error', logoProblem);
    }
  } catch (error) {
    if (useProjectStore.getState().sessionId === sessionId) {
      notify('error', `Applying the Brand Kit failed. ${describeError(error)}`);
    }
  } finally {
    useBrandKitLibraryStore.getState().setBusy(false);
  }
}

/** Keeps an unreadable library file as a backup and starts an empty library. */
export async function startNewBrandKitLibrary(): Promise<void> {
  const confirmed = await useUiStore.getState().confirm({
    title: 'Start a new Brand Kit library?',
    message:
      'The unreadable library file is kept as a backup in the data folder of Koma Motion, and an empty library is started. Nothing is deleted.',
    confirmLabel: 'Keep backup and start new',
    cancelLabel: 'Cancel',
    destructive: false,
  });
  if (!confirmed) {
    return;
  }
  try {
    const response = await invoke('koma:brand-kits:start-new', {});
    if (response.status === 'failed') {
      notify('error', response.message);
      return;
    }
    notify('info', `The previous library was kept as "${response.backupFileName}".`);
  } catch (error) {
    notify('error', `Starting a new library failed. ${describeError(error)}`);
  }
  await loadBrandKitLibrary();
}
