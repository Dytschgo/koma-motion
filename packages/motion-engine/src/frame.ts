import {
  mixColours,
  type Easing,
  type ElementColours,
  type ElementMotionState,
  type HexColour,
  type Koma,
  type KomaBackground,
  type KomaElement,
  type TransitionStrategy,
} from '@koma-motion/core';
import { applyEasing, clamp01, getOperationProgress, lerp, type MotionRole } from './easing';
import { motionIssue, type MotionIssue } from './issues';
import { isSupportedOperation } from './validate';

/**
 * The parts of a transition that playback needs. `operation` is a plain
 * string: operations that this version does not know are reported and skipped
 * instead of breaking playback.
 */
export interface PlayableTransition {
  readonly strategy: TransitionStrategy;
  readonly easing: Easing;
  readonly elementTransitions: readonly PlayableElementTransition[];
}

export interface PlayableElementTransition {
  readonly persistentId: string;
  readonly operation: string;
  readonly from: ElementMotionState | null;
  readonly to: ElementMotionState | null;
}

export type FrameLayerRole = 'retained' | 'entering' | 'exiting' | 'outgoing' | 'incoming';

export interface FrameLayer {
  /** Unique within the frame and stable across the frames of one transition. */
  readonly key: string;
  readonly persistentId: string;
  readonly role: FrameLayerRole;
  /** The element in its interpolated state. */
  readonly element: KomaElement;
}

export interface Frame {
  readonly background: KomaBackground;
  readonly layers: readonly FrameLayer[];
}

function toLayers(koma: Koma): FrameLayer[] {
  return koma.elements
    .filter((element) => element.visible)
    .map((element) => ({
      key: `${element.persistentId}/retained`,
      persistentId: element.persistentId,
      role: 'retained',
      element,
    }));
}

/** A Koma at rest, in the same shape as an interpolated frame. */
export function komaToFrame(koma: Koma): Frame {
  return { background: koma.background, layers: toLayers(koma) };
}

function mixOptionalColour(
  from: HexColour | null | undefined,
  to: HexColour | null | undefined,
  amount: number,
): HexColour | null | undefined {
  if (typeof from === 'string' && typeof to === 'string') {
    return mixColours(from, to, amount);
  }
  // A colour cannot be interpolated with "no colour": switch half-way.
  return amount < 0.5 ? from : to;
}

function applyColours(element: KomaElement, colours: ElementColours): KomaElement {
  if (element.type === 'text') {
    return colours.text === undefined
      ? element
      : { ...element, style: { ...element.style, colour: colours.text } };
  }
  if (element.type === 'shape') {
    return {
      ...element,
      style: {
        ...element.style,
        ...(colours.fill === undefined ? {} : { fill: colours.fill }),
        ...(colours.stroke === undefined ? {} : { stroke: colours.stroke }),
      },
    };
  }
  return element;
}

interface InterpolatedState {
  position: KomaElement['position'];
  size: KomaElement['size'];
  rotation: number;
  opacity: number;
  colours: ElementColours;
  /** Progress of the cross-fade, or `null` when the object is not replaced. */
  replaceProgress: number | null;
}

function interpolateRetained(
  source: KomaElement,
  operations: readonly PlayableElementTransition[],
  amount: number,
): InterpolatedState {
  const state: InterpolatedState = {
    position: source.position,
    size: source.size,
    rotation: source.rotation,
    opacity: source.opacity,
    colours: {},
    replaceProgress: null,
  };

  for (const { operation, from, to } of operations) {
    if (from === null || to === null) {
      continue;
    }
    switch (operation) {
      case 'move':
        if (from.position !== undefined && to.position !== undefined) {
          state.position = {
            x: lerp(from.position.x, to.position.x, amount),
            y: lerp(from.position.y, to.position.y, amount),
          };
        }
        break;
      case 'scale':
        if (from.size !== undefined && to.size !== undefined) {
          state.size = {
            width: lerp(from.size.width, to.size.width, amount),
            height: lerp(from.size.height, to.size.height, amount),
          };
        }
        break;
      case 'rotate':
        if (from.rotation !== undefined && to.rotation !== undefined) {
          state.rotation = lerp(from.rotation, to.rotation, amount);
        }
        break;
      case 'fadeIn':
      case 'fadeOut':
        if (from.opacity !== undefined && to.opacity !== undefined) {
          state.opacity = lerp(from.opacity, to.opacity, amount);
        }
        break;
      case 'colourChange':
        if (from.colours !== undefined && to.colours !== undefined) {
          const text = mixOptionalColour(from.colours.text, to.colours.text, amount);
          const fill = mixOptionalColour(from.colours.fill, to.colours.fill, amount);
          const stroke = mixOptionalColour(from.colours.stroke, to.colours.stroke, amount);
          state.colours = {
            ...(typeof text === 'string' ? { text } : {}),
            ...(fill === undefined ? {} : { fill }),
            ...(stroke === undefined ? {} : { stroke }),
          };
        }
        break;
      case 'replace':
        state.replaceProgress = amount;
        break;
      default:
        break;
    }
  }
  return state;
}

function withGeometry(
  element: KomaElement,
  state: InterpolatedState,
  opacity: number,
): KomaElement {
  return {
    ...element,
    position: state.position,
    size: state.size,
    rotation: state.rotation,
    opacity: clamp01(opacity),
  };
}

/** Lists the operations of a transition that this version cannot play. */
export function findUnsupportedOperations(transition: PlayableTransition): MotionIssue[] {
  return transition.elementTransitions
    .filter(({ operation }) => !isSupportedOperation(operation))
    .map(({ operation, persistentId }) =>
      motionIssue(
        'unsupportedOperation',
        `The operation "${operation}" on "${persistentId}" is not supported by this version of Koma Motion and is not played.`,
        persistentId,
      ),
    );
}

/**
 * Computes what is visible at `progress` (0..1) of a transition.
 *
 * The frame is derived from the stored transition model only. This function
 * does not compare the Komas: detecting changes is the job of `diffKomas`.
 * At progress 0 the frame is exactly the source Koma, at progress 1 exactly
 * the target Koma.
 */
export function computeFrame(input: {
  readonly from: Koma;
  readonly to: Koma;
  readonly transition: PlayableTransition;
  readonly progress: number;
}): Frame {
  const { from, to, transition } = input;
  const progress = clamp01(input.progress);
  if (progress <= 0) {
    return komaToFrame(from);
  }
  if (progress >= 1) {
    return komaToFrame(to);
  }

  const operationsById = new Map<string, PlayableElementTransition[]>();
  for (const elementTransition of transition.elementTransitions) {
    if (!isSupportedOperation(elementTransition.operation)) {
      continue;
    }
    const operations = operationsById.get(elementTransition.persistentId) ?? [];
    operations.push(elementTransition);
    operationsById.set(elementTransition.persistentId, operations);
  }

  const progressOf = (role: MotionRole): number =>
    getOperationProgress(progress, transition.strategy, transition.easing, role);

  const targets = new Map(
    to.elements
      .filter((element) => element.visible)
      .map((element) => [element.persistentId, element]),
  );
  const sources = new Map(
    from.elements
      .filter((element) => element.visible)
      .map((element) => [element.persistentId, element]),
  );

  const layers: FrameLayer[] = [];

  for (const source of sources.values()) {
    if (targets.has(source.persistentId)) {
      continue;
    }
    const exits = (operationsById.get(source.persistentId) ?? []).some(
      (operation) => operation.operation === 'fadeOut' && operation.to === null,
    );
    layers.push({
      key: `${source.persistentId}/exiting`,
      persistentId: source.persistentId,
      role: 'exiting',
      element: exits
        ? { ...source, opacity: clamp01(source.opacity * (1 - progressOf('exiting'))) }
        : source,
    });
  }

  for (const target of targets.values()) {
    const { persistentId } = target;
    const operations = operationsById.get(persistentId) ?? [];
    const source = sources.get(persistentId);

    if (source === undefined) {
      const enters = operations.some(
        (operation) => operation.operation === 'fadeIn' && operation.from === null,
      );
      if (enters) {
        layers.push({
          key: `${persistentId}/entering`,
          persistentId,
          role: 'entering',
          element: { ...target, opacity: clamp01(target.opacity * progressOf('entering')) },
        });
      }
      continue;
    }

    const state = interpolateRetained(source, operations, progressOf('retained'));
    if (state.replaceProgress === null) {
      layers.push({
        key: `${persistentId}/retained`,
        persistentId,
        role: 'retained',
        element: applyColours(withGeometry(target, state, state.opacity), state.colours),
      });
    } else {
      const fade = state.replaceProgress;
      layers.push(
        {
          key: `${persistentId}/outgoing`,
          persistentId,
          role: 'outgoing',
          element: withGeometry(source, state, state.opacity * (1 - fade)),
        },
        {
          key: `${persistentId}/incoming`,
          persistentId,
          role: 'incoming',
          element: withGeometry(target, state, state.opacity * fade),
        },
      );
    }
  }

  return {
    background: {
      type: 'solid',
      colour: mixColours(
        from.background.colour,
        to.background.colour,
        applyEasing(transition.easing, progress),
      ),
    },
    layers,
  };
}
