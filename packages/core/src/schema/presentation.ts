import { z } from 'zod';
import { aspectRatioSchema } from '../geometry';
import { idSchema } from '../ids';
import { komaSchema, type Koma } from './koma';
import {
  komaTransitionSchema,
  TRANSITION_OPERATIONS,
  type TransitionOperation,
} from './transition';

export const MAX_KOMAS = 200;

export const presentationSchema = z
  .object({
    id: idSchema,
    title: z.string().max(300),
    objective: z.string().max(2000),
    audience: z.string().max(1000),
    narrative: z.string().max(10000),
    aspectRatio: aspectRatioSchema,
    komas: z.array(komaSchema).max(MAX_KOMAS),
    transitions: z.array(komaTransitionSchema).max(MAX_KOMAS),
  })
  .superRefine((presentation, context) => {
    const komaIds = new Set<string>();
    presentation.komas.forEach((koma, index) => {
      if (komaIds.has(koma.id)) {
        context.addIssue({
          code: 'custom',
          path: ['komas', index, 'id'],
          message: `Koma id "${koma.id}" is used more than once`,
        });
      }
      komaIds.add(koma.id);
    });

    const transitionIds = new Set<string>();
    presentation.transitions.forEach((transition, index) => {
      if (transitionIds.has(transition.id)) {
        context.addIssue({
          code: 'custom',
          path: ['transitions', index, 'id'],
          message: `Transition id "${transition.id}" is used more than once`,
        });
      }
      transitionIds.add(transition.id);
      if (!komaIds.has(transition.fromKomaId)) {
        context.addIssue({
          code: 'custom',
          path: ['transitions', index, 'fromKomaId'],
          message: `Transition starts at Koma "${transition.fromKomaId}", which does not exist`,
        });
      }
      if (!komaIds.has(transition.toKomaId)) {
        context.addIssue({
          code: 'custom',
          path: ['transitions', index, 'toKomaId'],
          message: `Transition ends at Koma "${transition.toKomaId}", which does not exist`,
        });
      }
    });
  });

export type Presentation = z.infer<typeof presentationSchema>;

/** Fields the structural checks read. Operation names from a file may be unknown. */
export interface TransitionStructure {
  readonly fromKomaId: string;
  readonly toKomaId: string;
  readonly elementTransitions: readonly TransitionOperationStructure[];
}

export interface TransitionOperationStructure {
  readonly persistentId: string;
  readonly operation: string;
  readonly from: { readonly elementId: string } | null;
  readonly to: { readonly elementId: string } | null;
}

export type TransitionStructureIssue =
  | { readonly code: 'missingSourceKoma'; readonly fromKomaId: string }
  | { readonly code: 'missingTargetKoma'; readonly toKomaId: string }
  | { readonly code: 'nonAdjacentKomas'; readonly fromTitle: string; readonly toTitle: string }
  | {
      readonly code: 'missingPersistentId';
      readonly persistentId: string;
      readonly komaTitle: string;
      readonly endpoint: 'source' | 'target';
    }
  | {
      readonly code: 'wrongElementId';
      readonly persistentId: string;
      readonly elementId: string;
      readonly actualElementId: string;
      readonly komaTitle: string;
      readonly endpoint: 'source' | 'target';
    }
  | {
      readonly code: 'neitherEndpoint';
      readonly persistentId: string;
      readonly operation: string;
    }
  | {
      readonly code: 'duplicateOperation';
      readonly persistentId: string;
      readonly operation: string;
    }
  | {
      readonly code: 'conflictingOperations';
      readonly persistentId: string;
      readonly operations: readonly TransitionOperation[];
    };

const KNOWN_OPERATIONS: readonly string[] = TRANSITION_OPERATIONS;

/**
 * Property written by each operation. `fadeIn` and `fadeOut` share opacity.
 * `replace` is not a property write: a cross-fade is stored together with the
 * property operations of the same object. `hold` shares an object with nothing.
 */
const PROPERTY_BY_OPERATION: Readonly<Record<TransitionOperation, string>> = {
  hold: 'hold',
  move: 'position',
  scale: 'size',
  rotate: 'rotation',
  fadeIn: 'opacity',
  fadeOut: 'opacity',
  colourChange: 'colours',
  replace: 'replace',
};

function isKnownOperation(operation: string): operation is TransitionOperation {
  return KNOWN_OPERATIONS.includes(operation);
}

function endpointIssue(
  koma: Koma,
  endpoint: 'source' | 'target',
  persistentId: string,
  state: { readonly elementId: string },
): TransitionStructureIssue | null {
  const element = koma.elements.find((candidate) => candidate.persistentId === persistentId);
  if (element === undefined) {
    return { code: 'missingPersistentId', persistentId, komaTitle: koma.title, endpoint };
  }
  if (element.id !== state.elementId) {
    return {
      code: 'wrongElementId',
      persistentId,
      elementId: state.elementId,
      actualElementId: element.id,
      komaTitle: koma.title,
      endpoint,
    };
  }
  return null;
}

function findConflicts(
  operations: readonly TransitionOperation[],
): readonly TransitionOperation[] | null {
  const unique: TransitionOperation[] = [];
  for (const operation of operations) {
    if (!unique.includes(operation)) {
      unique.push(operation);
    }
  }
  if (unique.length < 2) {
    return null;
  }

  const conflicting = new Set<TransitionOperation>();
  // `hold` cannot share an object. A cross-fade (`replace`) can: the diff
  // stores it beside move, scale, rotate, fade and colourChange.
  if (unique.includes('hold')) {
    for (const operation of unique) {
      conflicting.add(operation);
    }
  }

  const writers = new Map<string, TransitionOperation[]>();
  for (const operation of unique) {
    if (operation === 'hold' || operation === 'replace') {
      continue;
    }
    const property = PROPERTY_BY_OPERATION[operation];
    const group = writers.get(property) ?? [];
    group.push(operation);
    writers.set(property, group);
  }
  for (const group of writers.values()) {
    if (group.length > 1) {
      for (const operation of group) {
        conflicting.add(operation);
      }
    }
  }

  if (conflicting.size < 2) {
    return null;
  }
  return unique.filter((operation) => conflicting.has(operation));
}

function operationIssues(
  persistentId: string,
  operations: readonly TransitionOperation[],
): TransitionStructureIssue[] {
  const issues: TransitionStructureIssue[] = [];
  const counts = new Map<TransitionOperation, number>();
  for (const operation of operations) {
    counts.set(operation, (counts.get(operation) ?? 0) + 1);
  }
  for (const [operation, count] of counts) {
    if (count > 1) {
      issues.push({ code: 'duplicateOperation', persistentId, operation });
    }
  }
  const conflicts = findConflicts(operations);
  if (conflicts !== null) {
    issues.push({ code: 'conflictingOperations', persistentId, operations: conflicts });
  }
  return issues;
}

/**
 * Structural problems that make one stored transition unplayable.
 *
 * Unknown operation names are ignored: they are reported by the motion engine
 * and do not disable the other operations. Nothing here is a schema error, so
 * a bad element reference does not make the project unreadable. Comparing the
 * stored values with the Komas is a separate check.
 */
export function findTransitionStructureIssues(
  presentation: Presentation,
  transition: TransitionStructure,
): TransitionStructureIssue[] {
  const fromIndex = presentation.komas.findIndex((koma) => koma.id === transition.fromKomaId);
  const toIndex = presentation.komas.findIndex((koma) => koma.id === transition.toKomaId);
  const from = presentation.komas[fromIndex];
  const to = presentation.komas[toIndex];

  const issues: TransitionStructureIssue[] = [];
  if (from === undefined) {
    issues.push({ code: 'missingSourceKoma', fromKomaId: transition.fromKomaId });
  }
  if (to === undefined) {
    issues.push({ code: 'missingTargetKoma', toKomaId: transition.toKomaId });
  }
  if (from === undefined || to === undefined) {
    return issues;
  }
  if (toIndex !== fromIndex + 1) {
    issues.push({ code: 'nonAdjacentKomas', fromTitle: from.title, toTitle: to.title });
  }

  const operationsById = new Map<string, TransitionOperation[]>();
  for (const elementTransition of transition.elementTransitions) {
    if (!isKnownOperation(elementTransition.operation)) {
      continue;
    }
    const { persistentId, operation } = elementTransition;
    const operations = operationsById.get(persistentId) ?? [];
    operations.push(operation);
    operationsById.set(persistentId, operations);

    if (elementTransition.from === null && elementTransition.to === null) {
      issues.push({ code: 'neitherEndpoint', persistentId, operation });
      continue;
    }
    if (elementTransition.from !== null) {
      const issue = endpointIssue(from, 'source', persistentId, elementTransition.from);
      if (issue !== null) {
        issues.push(issue);
      }
    }
    if (elementTransition.to !== null) {
      const issue = endpointIssue(to, 'target', persistentId, elementTransition.to);
      if (issue !== null) {
        issues.push(issue);
      }
    }
  }

  for (const [persistentId, operations] of operationsById) {
    issues.push(...operationIssues(persistentId, operations));
  }
  return issues;
}
