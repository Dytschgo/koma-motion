import { TRANSITION_OPERATIONS, type Koma, type Presentation } from '@koma-motion/core';
import { diffKomas, isDeepEqual } from './diff';
import { motionIssue, type MotionIssue } from './issues';

/**
 * The parts of a transition that validation looks at. `operation` is a plain
 * string so that transitions from untrusted sources can be checked before
 * they are accepted into the document model.
 */
export interface TransitionLike {
  readonly fromKomaId: string;
  readonly toKomaId: string;
  readonly elementTransitions: readonly ElementTransitionLike[];
}

export interface ElementTransitionLike {
  readonly persistentId: string;
  readonly operation: string;
  readonly from: { readonly elementId: string } | null;
  readonly to: { readonly elementId: string } | null;
}

export function isSupportedOperation(operation: string): boolean {
  return TRANSITION_OPERATIONS.some((supported) => supported === operation);
}

function checkReference(
  koma: Koma,
  label: 'source' | 'target',
  persistentId: string,
  state: { readonly elementId: string },
): MotionIssue | null {
  const element = koma.elements.find((candidate) => candidate.persistentId === persistentId);
  if (element === undefined) {
    return motionIssue(
      'invalidElementReference',
      `The transition refers to "${persistentId}", which does not exist in the ${label} Koma "${koma.title}".`,
      persistentId,
    );
  }
  if (element.id !== state.elementId) {
    return motionIssue(
      'invalidElementReference',
      `The transition refers to element "${state.elementId}" for "${persistentId}", but the ${label} Koma "${koma.title}" contains element "${element.id}".`,
      persistentId,
    );
  }
  return null;
}

/**
 * Checks a transition against the presentation it belongs to. An empty result
 * means the transition can be played exactly as it is stored.
 */
export function validateTransition(
  transition: TransitionLike,
  presentation: Presentation,
): MotionIssue[] {
  const fromIndex = presentation.komas.findIndex((koma) => koma.id === transition.fromKomaId);
  const toIndex = presentation.komas.findIndex((koma) => koma.id === transition.toKomaId);
  const from = presentation.komas[fromIndex];
  const to = presentation.komas[toIndex];

  const issues: MotionIssue[] = [];
  if (from === undefined) {
    issues.push(
      motionIssue(
        'missingSourceKoma',
        `The source Koma "${transition.fromKomaId}" of the transition does not exist.`,
      ),
    );
  }
  if (to === undefined) {
    issues.push(
      motionIssue(
        'missingTargetKoma',
        `The target Koma "${transition.toKomaId}" of the transition does not exist.`,
      ),
    );
  }
  if (from === undefined || to === undefined) {
    return issues;
  }

  if (toIndex !== fromIndex + 1) {
    issues.push(
      motionIssue(
        'nonAdjacentKomas',
        `The transition connects "${from.title}" and "${to.title}", which do not follow one another.`,
      ),
    );
  }

  for (const elementTransition of transition.elementTransitions) {
    const { persistentId, operation } = elementTransition;
    if (!isSupportedOperation(operation)) {
      issues.push(
        motionIssue(
          'unsupportedOperation',
          `The operation "${operation}" on "${persistentId}" is not supported by this version of Koma Motion and is not played.`,
          persistentId,
        ),
      );
      continue;
    }
    if (elementTransition.from === null && elementTransition.to === null) {
      issues.push(
        motionIssue(
          'invalidElementReference',
          `The operation "${operation}" on "${persistentId}" has neither a source nor a target state.`,
          persistentId,
        ),
      );
      continue;
    }
    const references = [
      elementTransition.from === null
        ? null
        : checkReference(from, 'source', persistentId, elementTransition.from),
      elementTransition.to === null
        ? null
        : checkReference(to, 'target', persistentId, elementTransition.to),
    ];
    for (const issue of references) {
      if (issue !== null) {
        issues.push(issue);
      }
    }
  }

  if (issues.length > 0) {
    return issues;
  }

  const expected = diffKomas(from, to);
  if (!expected.ok) {
    return [...expected.error];
  }
  if (!isDeepEqual(expected.value.elementTransitions, transition.elementTransitions)) {
    issues.push(
      motionIssue(
        'staleTransition',
        `The transition from "${from.title}" to "${to.title}" no longer matches the content of the Komas.`,
      ),
    );
  }
  return issues;
}
