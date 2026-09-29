import type { Koma } from '@koma-motion/core';
import {
  computeFrame,
  komaToFrame,
  transitionBlocksPlayback,
  type Frame,
  type PlayableTransition,
} from '@koma-motion/motion-engine';

/**
 * The frame to show during a preview.
 *
 * With reduced motion nothing travels across the screen: the source Koma is
 * shown for the first half and the target Koma for the second half.
 *
 * A transition that must not be played stays on the source Koma until the
 * end, with and without reduced motion.
 */
export function getPreviewFrame(input: {
  readonly from: Koma;
  readonly to: Koma;
  readonly transition: PlayableTransition;
  readonly progress: number;
  readonly reducedMotion: boolean;
  /** When set, the stored transition is not interpolated. */
  readonly blocked?: boolean;
}): Frame {
  if (input.reducedMotion) {
    const blocked =
      input.blocked === true || transitionBlocksPlayback(input.from, input.to, input.transition);
    const cut = blocked ? 1 : 0.5;
    return komaToFrame(input.progress < cut ? input.from : input.to);
  }
  return computeFrame(input);
}

export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'finished';

export interface PlaybackState {
  readonly status: PlaybackStatus;
  /** 0..1 */
  readonly progress: number;
}

export const IDLE_PLAYBACK: PlaybackState = { status: 'idle', progress: 0 };

/** Progress after `elapsedMs` of playing a transition of `durationMs`. */
export function advancePlayback(
  state: PlaybackState,
  elapsedMs: number,
  durationMs: number,
): PlaybackState {
  if (state.status !== 'playing') {
    return state;
  }
  const progress =
    durationMs <= 0 ? 1 : Math.min(1, state.progress + Math.max(0, elapsedMs) / durationMs);
  return progress >= 1 ? { status: 'finished', progress: 1 } : { status: 'playing', progress };
}
