import type { Easing, TransitionStrategy } from '@koma-motion/core';

export function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

const EASING_FUNCTIONS: Readonly<Record<Easing, (t: number) => number>> = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - (1 - t) ** 3,
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
};

export function applyEasing(easing: Easing, progress: number): number {
  return EASING_FUNCTIONS[easing](clamp01(progress));
}

/** What an operation does to the presence of an object. */
export type MotionRole = 'exiting' | 'retained' | 'entering';

/** The part of the transition, as fractions of its duration, in which a role is animated. */
export interface TimingWindow {
  readonly start: number;
  readonly end: number;
}

const FULL_WINDOW: TimingWindow = { start: 0, end: 1 };

const STAGED_WINDOWS: Readonly<Record<MotionRole, TimingWindow>> = {
  exiting: { start: 0, end: 0.4 },
  retained: { start: 0.2, end: 0.8 },
  entering: { start: 0.6, end: 1 },
};

export function getTimingWindow(strategy: TransitionStrategy, role: MotionRole): TimingWindow {
  return strategy === 'staged' ? STAGED_WINDOWS[role] : FULL_WINDOW;
}

/** Progress of one operation (0..1, eased) at the given progress of the whole transition. */
export function getOperationProgress(
  progress: number,
  strategy: TransitionStrategy,
  easing: Easing,
  role: MotionRole,
): number {
  const { start, end } = getTimingWindow(strategy, role);
  return applyEasing(easing, (clamp01(progress) - start) / (end - start));
}
