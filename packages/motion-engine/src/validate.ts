import {
  findTransitionStructureIssues,
  TRANSITION_OPERATIONS,
  type ElementMotionState,
  type Koma,
  type Presentation,
  type TransitionStructureIssue,
} from '@koma-motion/core';
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
  readonly from: ElementMotionState | null;
  readonly to: ElementMotionState | null;
}

export function isSupportedOperation(operation: string): boolean {
  return TRANSITION_OPERATIONS.some((supported) => supported === operation);
}

function quoteList(values: readonly string[]): string {
  const quoted = values.map((value) => `"${value}"`);
  const last = quoted.at(-1);
  if (last === undefined) {
    return '';
  }
  if (quoted.length === 1) {
    return last;
  }
  if (quoted.length === 2) {
    return `${quoted[0] ?? ''} and ${last}`;
  }
  return `${quoted.slice(0, -1).join(', ')} and ${last}`;
}

function toMotionIssue(issue: TransitionStructureIssue): MotionIssue {
  switch (issue.code) {
    case 'missingSourceKoma':
      return motionIssue(
        'missingSourceKoma',
        `The source Koma "${issue.fromKomaId}" of the transition does not exist.`,
      );
    case 'missingTargetKoma':
      return motionIssue(
        'missingTargetKoma',
        `The target Koma "${issue.toKomaId}" of the transition does not exist.`,
      );
    case 'nonAdjacentKomas':
      return motionIssue(
        'nonAdjacentKomas',
        `The transition connects "${issue.fromTitle}" and "${issue.toTitle}", which do not follow one another.`,
      );
    case 'missingPersistentId':
      return motionIssue(
        'invalidElementReference',
        `The transition refers to "${issue.persistentId}", which does not exist in the ${issue.endpoint} Koma "${issue.komaTitle}".`,
        issue.persistentId,
      );
    case 'wrongElementId':
      return motionIssue(
        'invalidElementReference',
        `The transition refers to element "${issue.elementId}" for "${issue.persistentId}", but the ${issue.endpoint} Koma "${issue.komaTitle}" contains element "${issue.actualElementId}".`,
        issue.persistentId,
      );
    case 'neitherEndpoint':
      return motionIssue(
        'invalidElementReference',
        `The operation "${issue.operation}" on "${issue.persistentId}" has neither a source nor a target state.`,
        issue.persistentId,
      );
    case 'duplicateOperation':
      return motionIssue(
        'duplicateOperation',
        `There is more than one "${issue.operation}" operation on "${issue.persistentId}". The transition is not played.`,
        issue.persistentId,
      );
    case 'conflictingOperations':
      return motionIssue(
        'conflictingOperations',
        `The operations ${quoteList(issue.operations)} on "${issue.persistentId}" conflict. The transition is not played.`,
        issue.persistentId,
      );
  }
}

/**
 * Checks a transition against the presentation it belongs to. An empty result
 * means the transition can be played exactly as it is stored. Issues are
 * reported and the transition is left unchanged.
 */
export function validateTransition(
  transition: TransitionLike,
  presentation: Presentation,
): MotionIssue[] {
  const structural = findTransitionStructureIssues(presentation, transition).map(toMotionIssue);
  const unsupported = transition.elementTransitions
    .filter((elementTransition) => !isSupportedOperation(elementTransition.operation))
    .map((elementTransition) =>
      motionIssue(
        'unsupportedOperation',
        `The operation "${elementTransition.operation}" on "${elementTransition.persistentId}" is not supported by this version of Koma Motion and is not played.`,
        elementTransition.persistentId,
      ),
    );

  if (structural.length > 0) {
    return [...structural, ...unsupported];
  }

  const supported = transition.elementTransitions.filter((elementTransition) =>
    isSupportedOperation(elementTransition.operation),
  );
  // An unknown operation on its own is a warning, not a stale transition.
  // An empty operation list, or any supported list, still has to match the Komas.
  if (supported.length === 0 && unsupported.length > 0) {
    return unsupported;
  }

  const from = presentation.komas.find((koma) => koma.id === transition.fromKomaId);
  const to = presentation.komas.find((koma) => koma.id === transition.toKomaId);
  if (from === undefined || to === undefined) {
    return unsupported;
  }

  const expected = diffKomas(from, to);
  if (!expected.ok) {
    return [...expected.error, ...unsupported];
  }
  if (!isDeepEqual(expected.value.elementTransitions, supported)) {
    return [
      motionIssue(
        'staleTransition',
        `The transition from "${from.title}" to "${to.title}" no longer matches the content of the Komas.`,
      ),
      ...unsupported,
    ];
  }
  return unsupported;
}

/**
 * The persistent ids of the objects whose stored operations differ from the
 * operations the current Komas call for, in the order of the Komas. Empty
 * when the Komas cannot be compared or nothing differs.
 */
export function findOutdatedObjects(transition: TransitionLike, from: Koma, to: Koma): string[] {
  const expected = diffKomas(from, to);
  if (!expected.ok) {
    return [];
  }
  const group = (operations: readonly ElementTransitionLike[]): Map<string, unknown[]> => {
    const grouped = new Map<string, unknown[]>();
    for (const operation of operations) {
      grouped.set(operation.persistentId, [
        ...(grouped.get(operation.persistentId) ?? []),
        operation,
      ]);
    }
    return grouped;
  };
  const stored = group(
    transition.elementTransitions.filter((operation) => isSupportedOperation(operation.operation)),
  );
  const current = group(expected.value.elementTransitions);
  const ordered = [
    ...new Set([
      ...from.elements.map((element) => element.persistentId),
      ...to.elements.map((element) => element.persistentId),
      ...stored.keys(),
    ]),
  ];
  return ordered.filter(
    (persistentId) => !isDeepEqual(stored.get(persistentId), current.get(persistentId)),
  );
}

type Operations = TransitionLike['elementTransitions'];

/**
 * Verdicts by identity of source Koma, target Koma and operation list.
 * Documents are immutable, so the same three objects always give the same
 * verdict. Entries disappear together with the objects they describe.
 */
const verdicts = new WeakMap<Koma, WeakMap<Koma, WeakMap<Operations, boolean>>>();

/**
 * Whether the stored operations must not be interpolated between these two
 * Komas. Adjacency is not decided here: the caller already supplied the
 * endpoints, and a presentation-level failure is passed in as `blocked`.
 *
 * Playback asks this for every frame. The validation runs once for the same
 * Komas and operations and its verdict is reused, so a frame costs a lookup.
 * A verdict cannot be supplied from outside: whatever is played has been
 * validated here.
 */
export function transitionBlocksPlayback(
  from: Koma,
  to: Koma,
  transition: { readonly elementTransitions: Operations },
): boolean {
  const operations = transition.elementTransitions;
  let byTarget = verdicts.get(from);
  if (byTarget === undefined) {
    byTarget = new WeakMap();
    verdicts.set(from, byTarget);
  }
  let byOperations = byTarget.get(to);
  if (byOperations === undefined) {
    byOperations = new WeakMap();
    byTarget.set(to, byOperations);
  }
  const known = byOperations.get(operations);
  if (known !== undefined) {
    return known;
  }
  const blocked = validateForPlayback(from, to, operations);
  byOperations.set(operations, blocked);
  return blocked;
}

function validateForPlayback(from: Koma, to: Koma, operations: Operations): boolean {
  const presentation: Presentation = {
    id: 'playback',
    title: '',
    objective: '',
    audience: '',
    narrative: '',
    aspectRatio: '16:9',
    komas: [
      { ...from, id: 'playback-source' },
      { ...to, id: 'playback-target' },
    ],
    transitions: [],
  };
  return validateTransition(
    {
      fromKomaId: 'playback-source',
      toKomaId: 'playback-target',
      elementTransitions: operations,
    },
    presentation,
  ).some((issue) => issue.code !== 'unsupportedOperation');
}
