import {
  collectElementIdentities,
  describeIssues,
  err,
  komaSchema,
  ok,
  toValidationIssues,
  type ElementColours,
  type ElementMotionState,
  type ElementTransition,
  type Koma,
  type KomaElement,
  type Result,
} from '@koma-motion/core';
import { motionIssue, type MotionIssue } from './issues';

/** Differences smaller than this are treated as no change. */
export const GEOMETRY_EPSILON = 0.001;

export interface KomaDiffSummary {
  /** Objects that exist in both Komas. */
  readonly retained: readonly string[];
  /** Retained objects without any change. */
  readonly unchanged: readonly string[];
  readonly entering: readonly string[];
  readonly exiting: readonly string[];
}

export interface KomaDiff {
  readonly elementTransitions: readonly ElementTransition[];
  readonly summary: KomaDiffSummary;
  readonly warnings: readonly MotionIssue[];
}

function isSameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) < GEOMETRY_EPSILON;
}

export function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return isSameNumber(a, b);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => isDeepEqual(item, b[index]));
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    if (Array.isArray(a) || Array.isArray(b)) {
      return false;
    }
    const left: Readonly<Record<string, unknown>> = { ...a };
    const right: Readonly<Record<string, unknown>> = { ...b };
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => Object.hasOwn(right, key) && isDeepEqual(left[key], right[key]))
    );
  }
  return false;
}

/** The colours of an element that can be interpolated. */
export function getElementColours(element: KomaElement): ElementColours {
  switch (element.type) {
    case 'text':
      return { text: element.style.colour };
    case 'shape':
      return { fill: element.style.fill, stroke: element.style.stroke };
    case 'image':
    case 'group':
      return {};
  }
}

/** Everything about an element that cannot be interpolated and therefore needs `replace`. */
function getDiscreteState(element: KomaElement): unknown {
  switch (element.type) {
    case 'text': {
      const { colour: _colour, ...style } = element.style;
      return { type: element.type, content: element.content, style };
    }
    case 'shape': {
      const { fill: _fill, stroke: _stroke, ...style } = element.style;
      return { type: element.type, content: element.content, style };
    }
    case 'image':
      return { type: element.type, content: element.content, style: element.style };
    case 'group':
      return {
        type: element.type,
        referenceSize: element.content.referenceSize,
        // Children are compared without their identifiers: a copied group is the same group.
        children: element.content.children.map(({ id: _id, ...child }) => child),
      };
  }
}

function findDuplicatePersistentIds(koma: Koma): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { persistentId } of collectElementIdentities(koma.elements)) {
    if (seen.has(persistentId)) {
      duplicates.add(persistentId);
    }
    seen.add(persistentId);
  }
  return [...duplicates].sort();
}

function validateKoma(koma: Koma, label: 'source' | 'target'): MotionIssue[] {
  const duplicates = findDuplicatePersistentIds(koma);
  if (duplicates.length > 0) {
    return duplicates.map((persistentId) =>
      motionIssue(
        'duplicatePersistentId',
        `The ${label} Koma "${koma.title}" contains more than one object with the persistent id "${persistentId}". Motion cannot tell them apart.`,
        persistentId,
      ),
    );
  }
  const validated = komaSchema.safeParse(koma);
  if (!validated.success) {
    return [
      motionIssue(
        'invalidKoma',
        `The ${label} Koma "${koma.title}" is not valid:\n${describeIssues(toValidationIssues(validated.error))}`,
      ),
    ];
  }
  return [];
}

function indexVisibleElements(koma: Koma): Map<string, KomaElement> {
  return new Map(
    koma.elements
      .filter((element) => element.visible)
      .map((element) => [element.persistentId, element]),
  );
}

function compareRetained(
  source: KomaElement,
  target: KomaElement,
  warnings: MotionIssue[],
): ElementTransition[] {
  const { persistentId } = target;
  const transitions: ElementTransition[] = [];
  const add = (
    operation: ElementTransition['operation'],
    from: Omit<ElementMotionState, 'elementId'>,
    to: Omit<ElementMotionState, 'elementId'>,
  ): void => {
    transitions.push({
      persistentId,
      operation,
      from: { elementId: source.id, ...from },
      to: { elementId: target.id, ...to },
    });
  };

  if (source.type !== target.type) {
    warnings.push(
      motionIssue(
        'ambiguousState',
        `"${persistentId}" is a ${source.type} in the source Koma and a ${target.type} in the target Koma. It is replaced instead of transformed.`,
        persistentId,
      ),
    );
  }
  if (!isDeepEqual(getDiscreteState(source), getDiscreteState(target))) {
    add('replace', {}, {});
  }
  if (
    !isSameNumber(source.position.x, target.position.x) ||
    !isSameNumber(source.position.y, target.position.y)
  ) {
    add('move', { position: source.position }, { position: target.position });
  }
  if (
    !isSameNumber(source.size.width, target.size.width) ||
    !isSameNumber(source.size.height, target.size.height)
  ) {
    add('scale', { size: source.size }, { size: target.size });
  }
  if (!isSameNumber(source.rotation, target.rotation)) {
    add('rotate', { rotation: source.rotation }, { rotation: target.rotation });
  }
  if (!isSameNumber(source.opacity, target.opacity)) {
    add(
      target.opacity > source.opacity ? 'fadeIn' : 'fadeOut',
      { opacity: source.opacity },
      { opacity: target.opacity },
    );
  }
  if (source.type === target.type) {
    const sourceColours = getElementColours(source);
    const targetColours = getElementColours(target);
    if (!isDeepEqual(sourceColours, targetColours)) {
      add('colourChange', { colours: sourceColours }, { colours: targetColours });
    }
  }
  if (transitions.length === 0) {
    add('hold', {}, {});
  }
  return transitions;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Compares two Komas by persistent identity and describes, as element-level
 * operations, how the source turns into the target.
 *
 * The result is deterministic: the same two Komas always produce the same
 * operations in the same order. Invisible elements do not take part; the
 * children of groups move with their group.
 */
export function diffKomas(from: Koma, to: Koma): Result<KomaDiff, readonly MotionIssue[]> {
  const errors = [...validateKoma(from, 'source'), ...validateKoma(to, 'target')];
  if (errors.length > 0) {
    return err(errors);
  }

  const sources = indexVisibleElements(from);
  const targets = indexVisibleElements(to);
  const persistentIds = [...new Set([...sources.keys(), ...targets.keys()])].sort(compareStrings);

  const warnings: MotionIssue[] = [];
  const elementTransitions: ElementTransition[] = [];
  const retained: string[] = [];
  const unchanged: string[] = [];
  const entering: string[] = [];
  const exiting: string[] = [];

  for (const persistentId of persistentIds) {
    const source = sources.get(persistentId);
    const target = targets.get(persistentId);
    if (source !== undefined && target !== undefined) {
      const transitions = compareRetained(source, target, warnings);
      retained.push(persistentId);
      if (transitions.every((transition) => transition.operation === 'hold')) {
        unchanged.push(persistentId);
      }
      elementTransitions.push(...transitions);
    } else if (target !== undefined) {
      entering.push(persistentId);
      elementTransitions.push({
        persistentId,
        operation: 'fadeIn',
        from: null,
        to: { elementId: target.id, opacity: target.opacity },
      });
    } else if (source !== undefined) {
      exiting.push(persistentId);
      elementTransitions.push({
        persistentId,
        operation: 'fadeOut',
        from: { elementId: source.id, opacity: source.opacity },
        to: null,
      });
    }
  }

  return ok({
    elementTransitions,
    summary: { retained, unchanged, entering, exiting },
    warnings,
  });
}
