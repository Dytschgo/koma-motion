/**
 * Readable descriptions of a stored transition and of whether it can be
 * played. Pure functions, so that the Inspector only renders the result.
 */
import type { Koma, KomaTransition } from '@koma-motion/core';
import type { MotionIssue } from '@koma-motion/motion-engine';

const OPERATION_LABELS: Readonly<Record<string, string>> = {
  hold: 'holds',
  move: 'moves',
  scale: 'changes size',
  rotate: 'rotates',
  fadeIn: 'fades in',
  fadeOut: 'fades out',
  colourChange: 'changes colour',
  replace: 'is replaced',
};

export type EffectKind = 'enters' | 'exits' | 'changes' | 'holds';

export interface ObjectEffect {
  readonly persistentId: string;
  readonly name: string;
  readonly kind: EffectKind;
  /** For example "moves, changes size". */
  readonly description: string;
}

export interface MotionSummary {
  readonly effects: readonly ObjectEffect[];
  readonly counts: Readonly<Record<EffectKind, number>>;
}

/** What happens to each object, one entry per object in the order of the stored operations. */
export function summariseMotion(transition: KomaTransition, from: Koma, to: Koma): MotionSummary {
  const names = new Map<string, string>();
  for (const element of [...from.elements, ...to.elements]) {
    const name = element.name.trim();
    if (name !== '') {
      names.set(element.persistentId, name);
    }
  }
  const grouped = new Map<string, { kinds: Set<EffectKind>; labels: string[] }>();
  for (const item of transition.elementTransitions) {
    const kind: EffectKind =
      item.from === null
        ? 'enters'
        : item.to === null
          ? 'exits'
          : item.operation === 'hold'
            ? 'holds'
            : 'changes';
    const label =
      kind === 'enters' || kind === 'exits'
        ? kind
        : (OPERATION_LABELS[item.operation] ?? item.operation);
    const entry = grouped.get(item.persistentId) ?? { kinds: new Set(), labels: [] };
    entry.kinds.add(kind);
    if (!entry.labels.includes(label)) {
      entry.labels.push(label);
    }
    grouped.set(item.persistentId, entry);
  }
  const counts: Record<EffectKind, number> = { enters: 0, exits: 0, changes: 0, holds: 0 };
  const effects = [...grouped.entries()].map(([persistentId, entry]): ObjectEffect => {
    // An object that holds and also changes, changes.
    const kind: EffectKind = entry.kinds.has('enters')
      ? 'enters'
      : entry.kinds.has('exits')
        ? 'exits'
        : entry.kinds.has('changes')
          ? 'changes'
          : 'holds';
    counts[kind] += 1;
    return {
      persistentId,
      name: names.get(persistentId) ?? persistentId,
      kind,
      description: entry.labels
        .filter((label) => kind !== 'changes' || label !== 'holds')
        .join(', '),
    };
  });
  return { effects, counts };
}

export type MotionHealth = 'ready' | 'partial' | 'stale' | 'blocked';

export interface MotionStatus {
  readonly health: MotionHealth;
  readonly title: string;
  readonly detail: string;
}

/**
 * The state of a transition as the Inspector reports it. Anything but
 * `ready` means that the stored motion is not what the preview plays.
 */
export function getMotionStatus(issues: readonly MotionIssue[]): MotionStatus {
  if (issues.some((issue) => issue.code === 'staleTransition')) {
    return {
      health: 'stale',
      title: 'Motion is out of date',
      detail: 'The Komas changed. Recalculate motion to preview again.',
    };
  }
  const unsupported = issues.filter((issue) => issue.code === 'unsupportedOperation').length;
  if (issues.length > unsupported) {
    return {
      health: 'blocked',
      title: 'Motion cannot be played',
      detail: 'Preview is unavailable until this motion is repaired.',
    };
  }
  if (unsupported > 0) {
    return {
      health: 'partial',
      title: 'Some effects are skipped',
      detail: `${String(unsupported)} ${unsupported === 1 ? 'effect is' : 'effects are'} not supported by this version of Koma Motion and ${unsupported === 1 ? 'is' : 'are'} not played.`,
    };
  }
  return {
    health: 'ready',
    title: 'Ready to play',
    detail: 'The stored motion matches both Komas.',
  };
}

/** Effects that match a filter by object name or description, ignoring case. */
export function filterEffects(
  effects: readonly ObjectEffect[],
  query: string,
): readonly ObjectEffect[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return effects;
  }
  return effects.filter((effect) =>
    `${effect.name} ${effect.description}`.toLowerCase().includes(needle),
  );
}
