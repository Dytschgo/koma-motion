/**
 * Explains why a transition cannot play, or plays only in part, and what the
 * user can do about it. This is the only place that turns motion issues into
 * the words of the compact status on that transition in the Koma strip.
 */
import type { Koma, KomaTransition, Presentation } from '@koma-motion/core';
import {
  diffKomas,
  findOutdatedObjects,
  getMotionIssueRemedy,
  validateTransition,
  type MotionIssue,
  type MotionIssueRemedy,
} from '@koma-motion/motion-engine';

export interface TransitionIssueDetail {
  readonly message: string;
  /** What this issue means for the user, as a sentence. */
  readonly remedyText: string;
}

export interface TransitionAssessment {
  /** Playback and seeking are off while this is true. */
  readonly blocked: boolean;
  /**
   * The one thing that helps: regenerate the transition, correct a Koma by
   * hand, or nothing in this version. Only `regenerate` offers a fix action.
   */
  readonly remedy: MotionIssueRemedy;
  /** Short label for the Koma strip. */
  readonly label: string;
  readonly headline: string;
  /** The specific reason, as one or two sentences. */
  readonly reason: string;
  readonly remedyText: string;
  /** The Komas a manual correction concerns. */
  readonly komasToEdit: readonly ('source' | 'target')[];
  readonly details: readonly TransitionIssueDetail[];
}

const MAX_NAMED_OBJECTS = 3;

function listNames(names: readonly string[]): string {
  const quoted = names.slice(0, MAX_NAMED_OBJECTS).map((name) => `"${name}"`);
  const rest = names.length - quoted.length;
  if (rest > 0) {
    quoted.push(`${String(rest)} more ${rest === 1 ? 'object' : 'objects'}`);
  }
  if (quoted.length <= 1) {
    return quoted.join('');
  }
  return `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1) ?? ''}`;
}

function objectNames(persistentIds: readonly string[], from: Koma, to: Koma): string[] {
  const names = new Map<string, string>();
  for (const element of [...to.elements, ...from.elements]) {
    names.set(element.persistentId, element.name);
  }
  return persistentIds.map((persistentId) => names.get(persistentId) ?? persistentId);
}

function describeDetail(issue: MotionIssue, remedy: MotionIssueRemedy): TransitionIssueDetail {
  switch (getMotionIssueRemedy(issue.code)) {
    case 'regenerate':
      return {
        message: issue.message,
        remedyText: 'Regenerating rebuilds the motion from the two Komas.',
      };
    case 'editKoma':
      return {
        message: issue.message,
        remedyText: 'Koma Motion cannot fix this automatically. Correct the Koma by hand.',
      };
    case 'futureVersion':
      return {
        message: issue.message,
        remedyText:
          remedy === 'regenerate'
            ? 'Regenerating removes this operation, because this version cannot play it.'
            : 'Playing it needs a later version of Koma Motion. Nothing needs to be fixed here.',
      };
    case 'none':
      return { message: issue.message, remedyText: 'Koma Motion cannot fix this automatically.' };
  }
}

function overallRemedy(issues: readonly MotionIssue[]): MotionIssueRemedy {
  const remedies = new Set(issues.map((issue) => getMotionIssueRemedy(issue.code)));
  // Regeneration cannot succeed while a Koma is broken, so that comes first.
  if (remedies.has('editKoma')) return 'editKoma';
  if (remedies.has('none')) return 'none';
  if (remedies.has('regenerate')) return 'regenerate';
  return 'futureVersion';
}

function assess(
  issues: readonly MotionIssue[],
  transition: KomaTransition,
  from: Koma,
  to: Koma,
): TransitionAssessment | null {
  if (issues.length === 0) {
    return null;
  }
  const blocking = issues.filter((issue) => issue.code !== 'unsupportedOperation');
  const blocked = blocking.length > 0;
  const remedy = overallRemedy(blocked ? blocking : issues);
  const details = issues.map((issue) => describeDetail(issue, remedy));
  const between = `from "${from.title}" to "${to.title}"`;

  if (!blocked) {
    const names = objectNames(
      issues.flatMap((issue) => (issue.persistentId === null ? [] : [issue.persistentId])),
      from,
      to,
    );
    return {
      blocked,
      remedy,
      label: 'Partly skipped',
      headline: `Part of the transition ${between} is skipped`,
      reason: `It contains motion from a newer version of Koma Motion${
        names.length === 0 ? '' : ` for ${listNames([...new Set(names)])}`
      }.`,
      remedyText:
        'The rest of the transition plays. Playing the skipped part needs a later version of Koma Motion.',
      komasToEdit: [],
      details,
    };
  }

  const headline = `The transition ${between} cannot play`;
  if (remedy === 'regenerate') {
    const stale = blocking.some((issue) => issue.code === 'staleTransition');
    const outdated = stale ? objectNames(findOutdatedObjects(transition, from, to), from, to) : [];
    const first = blocking.find((issue) => issue.code !== 'staleTransition') ?? blocking[0];
    return {
      blocked,
      remedy,
      label: stale ? 'Out of date' : 'Cannot play',
      headline,
      reason: stale
        ? `"${from.title}" or "${to.title}" changed after this motion was made, so it no longer matches ${
            outdated.length === 0 ? 'the Komas' : listNames(outdated)
          }.`
        : `The stored motion is damaged. ${first?.message ?? ''}`.trim(),
      remedyText:
        'Regenerate the transition to rebuild its motion from the current Komas. Both Komas stay as they are.',
      komasToEdit: [],
      details,
    };
  }

  const komasToEdit: ('source' | 'target')[] = [];
  const first = blocking[0];
  if (remedy === 'editKoma') {
    // A Koma compared with itself fails only when that Koma is broken.
    if (!diffKomas(from, from).ok) komasToEdit.push('source');
    if (!diffKomas(to, to).ok) komasToEdit.push('target');
  }
  return {
    blocked,
    remedy,
    label: 'Cannot play',
    headline,
    reason: first?.message ?? '',
    remedyText:
      remedy === 'editKoma'
        ? 'Koma Motion cannot fix this automatically. Correct the Koma by hand; the warning disappears when the transition can play.'
        : 'Koma Motion cannot fix this automatically.',
    komasToEdit,
    details,
  };
}

/** Assessments by identity: the same transition between the same Komas gives the same result. */
const cache = new WeakMap<
  KomaTransition,
  WeakMap<Koma, WeakMap<Koma, TransitionAssessment | null>>
>();

/**
 * What is wrong with a transition between two neighbouring Komas, or `null`
 * when it plays as stored. The caller guarantees that `from` and `to` are the
 * endpoints of `transition` and follow one another in `presentation`.
 */
export function assessTransition(
  presentation: Presentation,
  transition: KomaTransition,
  from: Koma,
  to: Koma,
): TransitionAssessment | null {
  let byFrom = cache.get(transition);
  if (byFrom === undefined) {
    byFrom = new WeakMap();
    cache.set(transition, byFrom);
  }
  let byTo = byFrom.get(from);
  if (byTo === undefined) {
    byTo = new WeakMap();
    byFrom.set(from, byTo);
  }
  const known = byTo.get(to);
  if (known !== undefined) {
    return known;
  }
  const result = assess(validateTransition(transition, presentation), transition, from, to);
  byTo.set(to, result);
  return result;
}
