/** Values derived from the project and the selection. */
import {
  findTransitionBetween,
  type Koma,
  type KomaElement,
  type KomaTransition,
  type Presentation,
} from '@koma-motion/core';
import { selectProject, useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';

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

/** The transition that Preview plays: the one being previewed, or the one of the selected Koma. */
export function useCurrentTransition(): KomaTransition | null {
  const project = useProjectStore(selectProject);
  const koma = useSelectedKoma();
  const preview = useUiStore((state) => state.preview);
  if (project === null) {
    return null;
  }
  if (preview !== null) {
    const previewed = project.presentation.transitions.find(
      (transition) => transition.id === preview.transitionId,
    );
    if (previewed !== undefined) {
      return previewed;
    }
  }
  return getTransitionOfKoma(project.presentation, koma?.id ?? null);
}

export function formatSeconds(milliseconds: number): string {
  return `${String(Number((milliseconds / 1000).toFixed(2)))} s`;
}
