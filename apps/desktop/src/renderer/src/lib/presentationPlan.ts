/**
 * What a presentation plays, step by step, and which steps cannot play.
 *
 * Komas are played in the order of the presentation. Between two Komas the
 * stored transition plays when it is valid. A step whose transition is
 * missing or blocked never plays: the presenter either returns to edit it or
 * chooses to cut across it, by name. Nothing here holds state; the player
 * asks again whenever the project changes.
 */
import {
  findTransitionBetween,
  type Koma,
  type KomaTransition,
  type Presentation,
} from '@koma-motion/core';
import { assessTransition } from './transitionIssues';

/** A step that cannot play. The presenter must choose before it is crossed. */
export interface PresentationProblem {
  /** Identifies the step by its two Komas, as the presenter sees it. */
  readonly key: string;
  readonly from: Koma;
  readonly to: Koma;
  /** 1-based number of the source Koma. */
  readonly fromNumber: number;
  readonly transitionId: string | null;
  /** Short label, for example "Out of date". */
  readonly label: string;
  readonly reason: string;
}

/** A step that plays, but leaves out operations from a newer version. */
export interface PresentationNote {
  readonly key: string;
  readonly fromNumber: number;
  readonly headline: string;
}

export type PresentationStep =
  | {
      readonly kind: 'motion';
      readonly key: string;
      readonly transition: KomaTransition;
      readonly from: Koma;
      readonly to: Koma;
    }
  | { readonly kind: 'problem'; readonly problem: PresentationProblem };

export interface PresentationReview {
  readonly problems: readonly PresentationProblem[];
  readonly notes: readonly PresentationNote[];
}

/** The key of the step between two Komas. Ids cannot contain a line break. */
export function stepKey(fromKomaId: string, toKomaId: string): string {
  return `${fromKomaId}\n${toKomaId}`;
}

/**
 * The step from the Koma at `fromIndex` to the Koma after it, or `null` when
 * there is no following Koma.
 */
export function getPresentationStep(
  presentation: Presentation,
  fromIndex: number,
): PresentationStep | null {
  const from = presentation.komas[fromIndex];
  const to = presentation.komas[fromIndex + 1];
  if (from === undefined || to === undefined) {
    return null;
  }
  const key = stepKey(from.id, to.id);
  const transition = findTransitionBetween(presentation, from.id, to.id);
  if (transition === undefined) {
    return {
      kind: 'problem',
      problem: {
        key,
        from,
        to,
        fromNumber: fromIndex + 1,
        transitionId: null,
        label: 'No transition',
        reason: `There is no motion from "${from.title}" to "${to.title}". A Koma may be damaged.`,
      },
    };
  }
  const assessment = assessTransition(presentation, transition, from, to);
  if (assessment?.blocked === true) {
    return {
      kind: 'problem',
      problem: {
        key,
        from,
        to,
        fromNumber: fromIndex + 1,
        transitionId: transition.id,
        label: assessment.label,
        reason: assessment.reason,
      },
    };
  }
  return { kind: 'motion', key, transition, from, to };
}

/**
 * Every step from the Koma at `startIndex` to the end that cannot play, and
 * every step that plays only in part. Steps before the start are not played.
 */
export function reviewPresentation(
  presentation: Presentation,
  startIndex: number,
): PresentationReview {
  const problems: PresentationProblem[] = [];
  const notes: PresentationNote[] = [];
  for (let index = Math.max(0, startIndex); index < presentation.komas.length - 1; index += 1) {
    const step = getPresentationStep(presentation, index);
    if (step === null) {
      break;
    }
    if (step.kind === 'problem') {
      problems.push(step.problem);
      continue;
    }
    const assessment = assessTransition(presentation, step.transition, step.from, step.to);
    if (assessment !== null) {
      notes.push({ key: step.key, fromNumber: index + 1, headline: assessment.headline });
    }
  }
  return { problems, notes };
}

/**
 * The Koma the presenter is on. When that Koma was deleted, the Koma that
 * took its place is used, or the last Koma when the deck became shorter.
 * `null` only for an empty presentation.
 */
export function resolvePresenterKoma(
  presentation: Presentation,
  komaId: string,
  lastIndex: number,
): { readonly koma: Koma; readonly index: number } | null {
  const { komas } = presentation;
  const index = komas.findIndex((koma) => koma.id === komaId);
  const found = komas[index];
  if (found !== undefined) {
    return { koma: found, index };
  }
  if (komas.length === 0) {
    return null;
  }
  const fallback = Math.min(Math.max(0, lastIndex), komas.length - 1);
  const koma = komas[fallback];
  return koma === undefined ? null : { koma, index: fallback };
}

/**
 * The step that is playing, if it may still play: its transition still runs
 * between the same neighbouring Komas and is not blocked. Settings such as
 * the duration may have changed.
 */
export function resolvePlayingStep(
  presentation: Presentation,
  motion: { readonly transitionId: string; readonly fromKomaId: string; readonly toKomaId: string },
): Extract<PresentationStep, { kind: 'motion' }> | null {
  const fromIndex = presentation.komas.findIndex((koma) => koma.id === motion.fromKomaId);
  if (fromIndex < 0) {
    return null;
  }
  const step = getPresentationStep(presentation, fromIndex);
  if (
    step?.kind !== 'motion' ||
    step.to.id !== motion.toKomaId ||
    step.transition.id !== motion.transitionId
  ) {
    return null;
  }
  return step;
}
