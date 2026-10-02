/**
 * The steps between brand material in the chat and the main process. Files
 * are chosen in a native dialog of the main process; the window receives
 * display names and prepared content, never a path. Attaching, analyzing and
 * saving do not change the project. Applying is one undoable project change.
 */
import type { BrandKitLogoData } from '@koma-motion/brand-kit';
import { createRandomIdGenerator, type BrandKit } from '@koma-motion/core';
import { serialiseProject } from '@koma-motion/project-format';
import { useBrandProfileStore } from '../state/brandProfileStore';
import { applyBrandProfile } from '../state/commands';
import { selectProject, useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { invoke } from './api';

const idGenerator = createRandomIdGenerator();

/** True when the store holds material or work of the project that is open now. */
function current(projectSession: number, draftId: string): boolean {
  const state = useBrandProfileStore.getState();
  return (
    state.projectSession === projectSession &&
    state.draftId === draftId &&
    useProjectStore.getState().sessionId === projectSession
  );
}

/** Opens the native dialog and prepares the chosen files. Choosing again replaces them. */
export async function attachBrandMaterial(): Promise<void> {
  const projectSession = useProjectStore.getState().sessionId;
  let state = useBrandProfileStore.getState();
  if (state.attaching) return;
  if (state.projectSession !== projectSession || state.draftId === null) {
    // Material of a replaced project was already discarded by the main process.
    state.begin(projectSession, crypto.randomUUID());
    state = useBrandProfileStore.getState();
  }
  const draftId = state.draftId;
  if (draftId === null) return;
  state.setAttaching(true);
  state.setError(null);
  try {
    const response = await invoke('koma:brand-profile:attach', { sessionId: draftId });
    if (!current(projectSession, draftId)) return;
    if (response.status === 'prepared') {
      useBrandProfileStore.getState().setMaterial(response.material);
    } else if (response.status === 'failed') {
      useBrandProfileStore.getState().setError(response.message);
    }
  } catch {
    if (current(projectSession, draftId))
      useBrandProfileStore
        .getState()
        .setError('The files could not be prepared. Nothing was attached. Try again.');
  } finally {
    if (current(projectSession, draftId)) {
      const store = useBrandProfileStore.getState();
      store.setAttaching(false);
      store.setProgress(null);
      // A dismissed dialog or a failure with nothing attached leaves no draft behind.
      if (store.material === null && store.error === null) store.clear();
    }
  }
}

/** Removes the attached material and stops any work on it. The project is not changed. */
export async function discardBrandMaterial(): Promise<void> {
  const { draftId } = useBrandProfileStore.getState();
  useBrandProfileStore.getState().clear();
  if (draftId !== null) {
    await invoke('koma:brand-profile:cancel', { sessionId: draftId, scope: 'draft' }).catch(
      () => undefined,
    );
  }
}

/**
 * Makes a reviewed Brand Kit, logo and instructions the brand profile of the
 * open project, as one undoable change. Returns a sentence when it could not
 * be applied; the project is unchanged then.
 */
export function applyBrandProfileToProject(
  projectSession: number,
  profile: {
    readonly brandKit: BrandKit;
    readonly logo: BrandKitLogoData | null;
    readonly instructions: string;
  },
): { readonly status: 'applied' | 'unchanged' } | { readonly status: 'failed'; message: string } {
  const project = selectProject(useProjectStore.getState());
  if (project === null || useProjectStore.getState().sessionId !== projectSession)
    return {
      status: 'failed',
      message: 'The project was replaced, so the brand profile was not applied.',
    };
  try {
    const updated = applyBrandProfile(
      profile.brandKit,
      profile.logo,
      profile.instructions,
    )(project, idGenerator);
    if (updated === project) return { status: 'unchanged' };
    const serialised = serialiseProject(updated);
    if (!serialised.ok) throw new Error(serialised.error.message);
    // The editor shows the applied kit, not text typed for the previous one.
    useUiStore.getState().setBrandKitDraft(project.id, {});
    useProjectStore.getState().apply(() => updated);
    return { status: 'applied' };
  } catch (error) {
    return {
      status: 'failed',
      message: `The project was not changed. ${error instanceof Error ? error.message : 'Applying failed.'}`,
    };
  }
}
