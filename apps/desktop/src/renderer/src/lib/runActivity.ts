/**
 * What a run is doing, as far as Koma Motion can observe it. Pure functions,
 * so the rules can be tested without a window.
 *
 * The phase comes from the status events of the runtime and nothing else.
 * It says what Koma Motion saw (a process started, output arrived, the
 * answer is being checked), not what a model does internally.
 */
import type { ExecutionPhase, ExecutionStatusEvent } from '@koma-motion/agent-runtime';

export const ACTIVITY_PHASES = [
  'starting',
  'generating',
  'validating',
  'repairing',
  'completed',
  'failed',
  'cancelled',
] as const;
export type ActivityPhase = (typeof ACTIVITY_PHASES)[number];

const FROM_EXECUTION: Readonly<Record<ExecutionPhase, ActivityPhase>> = {
  preparing: 'starting',
  detecting: 'starting',
  generating: 'generating',
  validating: 'validating',
  repairing: 'repairing',
  converting: 'validating',
  succeeded: 'completed',
  failed: 'failed',
  timedOut: 'failed',
  cancelled: 'cancelled',
};

export const ACTIVITY_LABELS: Readonly<Record<ActivityPhase, string>> = {
  starting: 'Starting',
  generating: 'Generating',
  validating: 'Checking the answer',
  repairing: 'Correcting the answer',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Stopped',
};

/** The phase shown for a run with these status events. */
export function activityPhase(
  events: readonly Pick<ExecutionStatusEvent, 'phase'>[],
): ActivityPhase {
  const last = events.at(-1);
  return last === undefined ? 'starting' : FROM_EXECUTION[last.phase];
}

export function isFinalPhase(phase: ActivityPhase): boolean {
  return phase === 'completed' || phase === 'failed' || phase === 'cancelled';
}

/** Elapsed time as m:ss, or h:mm:ss from one hour. */
export function formatElapsed(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (value: number): string => String(value).padStart(2, '0');
  return hours > 0
    ? `${String(hours)}:${two(minutes)}:${two(seconds)}`
    : `${String(minutes)}:${two(seconds)}`;
}

export interface TimelineEntry {
  readonly phase: ActivityPhase;
  readonly message: string;
  /** Milliseconds since the run started. */
  readonly offset: number;
}

/**
 * The status events of a run as a timeline. Repeated messages are merged, so
 * frequent progress updates do not flood the list.
 */
export function buildTimeline(
  events: readonly Pick<ExecutionStatusEvent, 'phase' | 'message' | 'timestamp'>[],
  startedAt: number,
): TimelineEntry[] {
  const timeline: TimelineEntry[] = [];
  for (const event of events) {
    const previous = timeline.at(-1);
    const phase = FROM_EXECUTION[event.phase];
    if (previous?.message === event.message && previous.phase === phase) continue;
    const at = Date.parse(event.timestamp);
    timeline.push({
      phase,
      message: event.message,
      offset: Number.isFinite(at) ? Math.max(0, at - startedAt) : 0,
    });
  }
  return timeline;
}
