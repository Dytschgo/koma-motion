import type { GenerationInput } from '@koma-motion/agent-runtime';
import type { KomaProject } from '@koma-motion/core';
import { validateTransition } from '@koma-motion/motion-engine';
import { canRecalculateTransition, recalculateTransition } from '../state/commands';

/** Repair only invalid motion that can be rebuilt from the current Komas. One undo step. */
export function repairProjectMotion(project: KomaProject): KomaProject {
  return project.presentation.transitions.reduce((current, transition) => {
    const blocking = validateTransition(transition, current.presentation).some(
      (issue) => issue.code !== 'unsupportedOperation',
    );
    return blocking && canRecalculateTransition(current.presentation, transition.id)
      ? recalculateTransition(transition.id)(current)
      : current;
  }, project);
}

export function isRecheckCommand(text: string): boolean {
  return /^\/?recheck[.!]?$/i.test(text.trim());
}

/** Retry the original scope and count, using only the references currently consented to. */
export function prepareRecheck(
  input: GenerationInput,
  project: KomaProject,
  references: GenerationInput['references'],
): GenerationInput | null {
  if (
    input.targetKomaId !== undefined &&
    !project.presentation.komas.some((koma) => koma.id === input.targetKomaId)
  )
    return null;
  const { references: _previousReferences, ...request } = input;
  return { ...request, ...(references?.length ? { references: [...references] } : {}) };
}
