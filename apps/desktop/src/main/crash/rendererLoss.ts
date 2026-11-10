/**
 * What to do when the process that draws the window is gone. Pure decisions,
 * so every reason Electron reports has a tested answer.
 *
 * | Reason                                | Answer                                  |
 * | ------------------------------------- | --------------------------------------- |
 * | `crashed`, `abnormal-exit`, `killed`  | offer Reload window or Quit             |
 * | `clean-exit`                          | the same: the window is blank either way |
 * | `oom`, `memory-eviction`              | the same, and say memory ran out        |
 * | `launch-failed`                       | the same, and say it may fail again     |
 * | `integrity-failure`                   | Quit only: a reload starts the same code |
 * | a reason this version does not know   | offer Reload window or Quit             |
 * | third loss within a minute            | Quit only: reloading is not helping     |
 */

export const LOSS_WINDOW_MS = 60_000;
export const MAX_LOSSES_IN_WINDOW = 3;

const RECOVERY_NOTE =
  'Unsaved changes are offered for recovery as an unsaved copy when the window reloads or Koma Motion starts again. Changes from the last moments may be missing. Your project file has not been changed.';
const LOG_NOTE = 'Settings > About has a diagnostics log you can attach to a report.';

export interface LossDecision {
  /** Whether "Reload window" is offered. Otherwise the only choice is to quit. */
  readonly canReload: boolean;
  readonly message: string;
  readonly detail: string;
}

/**
 * `recentLosses` holds the times of earlier losses of this window in
 * milliseconds; `now` is the time of this one on the same clock.
 */
export function decideRendererLoss(
  reason: string,
  recentLosses: readonly number[],
  now: number,
): LossDecision {
  const losses = recentLosses.filter((time) => now - time < LOSS_WINDOW_MS).length + 1;
  if (losses >= MAX_LOSSES_IN_WINDOW) {
    return {
      canReload: false,
      message: 'The Koma Motion window keeps stopping.',
      detail: `Reloading did not help, so Koma Motion will quit. ${RECOVERY_NOTE} ${LOG_NOTE}`,
    };
  }
  switch (reason) {
    case 'integrity-failure':
      return {
        canReload: false,
        message: 'The Koma Motion window could not start.',
        detail: `A code integrity check of the operating system failed. Reloading would fail the same way, so Koma Motion will quit. Install Koma Motion again if this repeats. ${RECOVERY_NOTE}`,
      };
    case 'launch-failed':
      return {
        canReload: true,
        message: 'The Koma Motion window could not start.',
        detail: `You can try again. Install Koma Motion again if this repeats. ${RECOVERY_NOTE}`,
      };
    case 'oom':
    case 'memory-eviction':
      return {
        canReload: true,
        message: 'The Koma Motion window ran out of memory.',
        detail: `Close other applications or use fewer large images, then reload the window. ${RECOVERY_NOTE}`,
      };
    default:
      return {
        canReload: true,
        message: 'The Koma Motion window stopped working.',
        detail: `Reload the window to continue. ${RECOVERY_NOTE} ${LOG_NOTE}`,
      };
  }
}

export const UNRESPONSIVE_MESSAGE = 'The Koma Motion window is not responding.';
export const UNRESPONSIVE_DETAIL = `You can keep waiting, or reload the window. ${RECOVERY_NOTE}`;

/** The loss times that still count, with this one added. Bounded by the window. */
export function rememberLoss(recentLosses: readonly number[], now: number): number[] {
  return [...recentLosses.filter((time) => now - time < LOSS_WINDOW_MS), now];
}
