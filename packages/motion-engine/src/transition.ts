import {
  DEFAULT_TRANSITION_DURATION_MS,
  EASINGS,
  err,
  MAX_TRANSITION_DURATION_MS,
  MIN_TRANSITION_DURATION_MS,
  ok,
  TRANSITION_STRATEGIES,
  type Easing,
  type IdGenerator,
  type Koma,
  type KomaTransition,
  type Presentation,
  type Result,
  type TransitionStrategy,
} from '@koma-motion/core';
import { diffKomas, type KomaDiff } from './diff';
import { motionIssue, type MotionIssue } from './issues';

export const DEFAULT_STRATEGY: TransitionStrategy = 'continuous';
export const DEFAULT_EASING: Easing = 'easeInOut';
const MAX_RATIONALE_LENGTH = 1000;

/**
 * Settings proposed by an agent or a person. Every value is untrusted and is
 * normalised before it becomes part of a transition.
 */
export interface TransitionSuggestion {
  readonly strategy?: unknown;
  readonly duration?: unknown;
  readonly easing?: unknown;
  readonly rationale?: unknown;
}

export interface NormalisedSettings {
  readonly strategy: TransitionStrategy;
  readonly duration: number;
  readonly easing: Easing;
  /** Empty when no usable rationale was suggested. */
  readonly rationale: string;
  readonly warnings: readonly MotionIssue[];
}

function isStrategy(value: unknown): value is TransitionStrategy {
  return TRANSITION_STRATEGIES.some((strategy) => strategy === value);
}

function isEasing(value: unknown): value is Easing {
  return EASINGS.some((easing) => easing === value);
}

function describeValue(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? typeof value);
}

export function normaliseDuration(value: number): number {
  return Math.round(
    Math.min(MAX_TRANSITION_DURATION_MS, Math.max(MIN_TRANSITION_DURATION_MS, value)),
  );
}

export function normaliseSettings(suggestion: TransitionSuggestion = {}): NormalisedSettings {
  const warnings: MotionIssue[] = [];

  let strategy = DEFAULT_STRATEGY;
  if (isStrategy(suggestion.strategy)) {
    strategy = suggestion.strategy;
  } else if (suggestion.strategy !== undefined) {
    warnings.push(
      motionIssue(
        'settingAdjusted',
        `The transition strategy "${describeValue(suggestion.strategy)}" is not supported. "${DEFAULT_STRATEGY}" is used instead.`,
      ),
    );
  }

  let easing = DEFAULT_EASING;
  if (isEasing(suggestion.easing)) {
    easing = suggestion.easing;
  } else if (suggestion.easing !== undefined) {
    warnings.push(
      motionIssue(
        'settingAdjusted',
        `The easing "${describeValue(suggestion.easing)}" is not supported. "${DEFAULT_EASING}" is used instead.`,
      ),
    );
  }

  let duration = DEFAULT_TRANSITION_DURATION_MS;
  if (typeof suggestion.duration === 'number' && Number.isFinite(suggestion.duration)) {
    duration = normaliseDuration(suggestion.duration);
    if (duration !== Math.round(suggestion.duration)) {
      warnings.push(
        motionIssue(
          'settingAdjusted',
          `The transition duration of ${String(suggestion.duration)} ms is outside the supported range. ${String(duration)} ms is used instead.`,
        ),
      );
    }
  } else if (suggestion.duration !== undefined) {
    warnings.push(
      motionIssue(
        'settingAdjusted',
        `The transition duration is not a number. ${String(duration)} ms is used instead.`,
      ),
    );
  }

  const rationale =
    typeof suggestion.rationale === 'string'
      ? suggestion.rationale.trim().slice(0, MAX_RATIONALE_LENGTH)
      : '';

  return { strategy, duration, easing, rationale, warnings };
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

/** A factual one-sentence description of a diff, used when no rationale was suggested. */
export function describeDiff(diff: KomaDiff): string {
  const { retained, unchanged, entering, exiting } = diff.summary;
  const changed = retained.length - unchanged.length;
  const parts: string[] = [];
  if (changed > 0) {
    parts.push(`${countLabel(changed, 'object changes', 'objects change')}`);
  }
  if (unchanged.length > 0) {
    parts.push(`${countLabel(unchanged.length, 'object holds', 'objects hold')}`);
  }
  if (entering.length > 0) {
    parts.push(`${countLabel(entering.length, 'object enters', 'objects enter')}`);
  }
  if (exiting.length > 0) {
    parts.push(`${countLabel(exiting.length, 'object exits', 'objects exit')}`);
  }
  return parts.length === 0 ? 'Both Komas are empty.' : `${parts.join(', ')}.`;
}

export interface BuiltTransition {
  readonly transition: KomaTransition;
  readonly diff: KomaDiff;
  readonly warnings: readonly MotionIssue[];
}

/** Builds the transition between two adjacent Komas. Suggested settings are normalised. */
export function buildTransition(input: {
  readonly id: string;
  readonly from: Koma;
  readonly to: Koma;
  readonly suggestion?: TransitionSuggestion;
}): Result<BuiltTransition, readonly MotionIssue[]> {
  const diff = diffKomas(input.from, input.to);
  if (!diff.ok) {
    return err(diff.error);
  }
  const settings = normaliseSettings(input.suggestion);
  return ok({
    transition: {
      id: input.id,
      fromKomaId: input.from.id,
      toKomaId: input.to.id,
      strategy: settings.strategy,
      duration: settings.duration,
      easing: settings.easing,
      elementTransitions: [...diff.value.elementTransitions],
      rationale: settings.rationale === '' ? describeDiff(diff.value) : settings.rationale,
    },
    diff: diff.value,
    warnings: [...settings.warnings, ...diff.value.warnings],
  });
}

export interface SyncedPresentation {
  readonly presentation: Presentation;
  readonly warnings: readonly MotionIssue[];
}

/**
 * Makes the transitions of a presentation match its Komas: one transition for
 * every adjacent pair. For rebuilt pairs, element operations are computed from
 * the current Komas. Settings and rationale of existing transitions are kept.
 *
 * Call this after every change to Komas or their order. With `previous`, a pair
 * whose Koma and transition objects are unchanged retains its stored motion,
 * even if that motion was already stale. Only rebuilt pairs report warnings.
 * Without `previous`, every pair is rebuilt and reports its warnings.
 */
export function syncTransitions(
  presentation: Presentation,
  idGenerator: IdGenerator,
  previous?: Presentation,
): SyncedPresentation {
  const warnings: MotionIssue[] = [];
  const transitions: KomaTransition[] = [];
  const previousPairs = new Map<Koma, Koma>();
  previous?.komas.forEach((to, index) => {
    const from = previous.komas[index - 1];
    if (from !== undefined) previousPairs.set(to, from);
  });
  const previousTransitions = new Set(previous?.transitions);

  presentation.komas.forEach((to, index) => {
    const from = presentation.komas[index - 1];
    if (from === undefined) {
      return;
    }
    const existing = presentation.transitions.find(
      (transition) => transition.fromKomaId === from.id && transition.toKomaId === to.id,
    );
    if (
      existing !== undefined &&
      previousPairs.get(to) === from &&
      previousTransitions.has(existing)
    ) {
      transitions.push(existing);
      return;
    }
    const built = buildTransition({
      id: existing?.id ?? idGenerator.next('transition', `${from.id}/${to.id}`),
      from,
      to,
      ...(existing === undefined ? {} : { suggestion: existing }),
    });
    if (built.ok) {
      transitions.push(built.value.transition);
      warnings.push(...built.value.warnings);
    } else {
      warnings.push(...built.error);
    }
  });

  return { presentation: { ...presentation, transitions }, warnings };
}
