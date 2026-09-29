/** Values derived from the project and the selection. */
import {
  findTransitionBetween,
  type Koma,
  type KomaElement,
  type KomaTransition,
  type Presentation,
} from '@koma-motion/core';
import { selectProject, useProjectStore } from '../state/projectStore';
import { useUiStore, type PreviewIdentity } from '../state/uiStore';

export interface TransitionContext {
  readonly transition: KomaTransition;
  readonly from: Koma;
  readonly to: Koma;
  readonly fromIndex: number;
}

export function getTransitionContext(
  presentation: Presentation,
  transitionId: string,
): TransitionContext | null {
  const transition = presentation.transitions.find((candidate) => candidate.id === transitionId);
  if (transition === undefined) {
    return null;
  }
  const fromIndex = presentation.komas.findIndex((koma) => koma.id === transition.fromKomaId);
  const from = presentation.komas[fromIndex];
  const to = presentation.komas.find((koma) => koma.id === transition.toKomaId);
  return from === undefined || to === undefined ? null : { transition, from, to, fromIndex };
}

/**
 * The transition that belongs to a Koma: the one that leads to the next
 * Koma, or for the last Koma the one that leads to it.
 */
export function getTransitionOfKoma(
  presentation: Presentation,
  komaId: string | null,
): KomaTransition | null {
  const index = presentation.komas.findIndex((koma) => koma.id === komaId);
  const koma = presentation.komas[index];
  if (koma === undefined) {
    return null;
  }
  const next = presentation.komas[index + 1];
  const previous = presentation.komas[index - 1];
  if (next !== undefined) {
    return findTransitionBetween(presentation, koma.id, next.id) ?? null;
  }
  if (previous !== undefined) {
    return findTransitionBetween(presentation, previous.id, koma.id) ?? null;
  }
  return null;
}

/**
 * A preview is valid only while a transition with this id still runs between
 * the same two Komas and those Komas are still neighbours in that order.
 * Duration and other settings may change. A missing id, different ends, or a
 * reorder that separates the pair does not.
 */
export function resolvePreviewTransition(
  presentation: Presentation,
  preview: Pick<PreviewIdentity, 'transitionId' | 'fromKomaId' | 'toKomaId'> | null,
): TransitionContext | null {
  if (preview === null) {
    return null;
  }
  const context = getTransitionContext(presentation, preview.transitionId);
  if (
    context === null ||
    context.transition.fromKomaId !== preview.fromKomaId ||
    context.transition.toKomaId !== preview.toKomaId
  ) {
    return null;
  }
  const toIndex = presentation.komas.findIndex((koma) => koma.id === preview.toKomaId);
  return toIndex === context.fromIndex + 1 ? context : null;
}

/**
 * The transition the transport and inspector edit. While a preview id is set,
 * only that identity is returned: a stale id is not replaced with another
 * transition. With no preview, this is the selected Koma's transition.
 */
export function getCurrentTransition(
  presentation: Presentation,
  selectedKomaId: string | null,
  preview: Pick<PreviewIdentity, 'transitionId' | 'fromKomaId' | 'toKomaId'> | null,
): KomaTransition | null {
  if (preview !== null) {
    return resolvePreviewTransition(presentation, preview)?.transition ?? null;
  }
  return getTransitionOfKoma(presentation, selectedKomaId);
}

export function useSelectedKoma(): Koma | null {
  const project = useProjectStore(selectProject);
  const selectedKomaId = useUiStore((state) => state.selectedKomaId);
  if (project === null) {
    return null;
  }
  const { komas } = project.presentation;
  return komas.find((koma) => koma.id === selectedKomaId) ?? komas[0] ?? null;
}

export function useSelectedElement(): KomaElement | null {
  const koma = useSelectedKoma();
  const selectedElementId = useUiStore((state) => state.selectedElementId);
  return koma?.elements.find((element) => element.id === selectedElementId) ?? null;
}

/** The transition the transport edits. See `getCurrentTransition`. */
export function useCurrentTransition(): KomaTransition | null {
  const project = useProjectStore(selectProject);
  const koma = useSelectedKoma();
  const preview = useUiStore((state) => state.preview);
  if (project === null) {
    return null;
  }
  return getCurrentTransition(project.presentation, koma?.id ?? null, preview);
}

export function formatSeconds(milliseconds: number): string {
  return `${String(Number((milliseconds / 1000).toFixed(2)))} s`;
}
