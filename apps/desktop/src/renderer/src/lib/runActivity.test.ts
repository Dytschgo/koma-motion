import type { ExecutionPhase } from '@koma-motion/agent-runtime';
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_PHASES,
  activityPhase,
  buildTimeline,
  formatElapsed,
  isFinalPhase,
} from './runActivity';

const at = (phase: ExecutionPhase, message: string, seconds: number) => ({
  phase,
  message,
  timestamp: new Date(Date.UTC(2026, 8, 30, 12, 0, seconds)).toISOString(),
});
const START = Date.UTC(2026, 8, 30, 12, 0, 0);

describe('run activity', () => {
  it('follows the observed phases of a run that needed a correction', () => {
    const sequence: ExecutionPhase[] = [
      'preparing',
      'detecting',
      'generating',
      'validating',
      'repairing',
      'validating',
      'converting',
      'succeeded',
    ];
    const phases = sequence.map((_, index) =>
      activityPhase(sequence.slice(0, index + 1).map((phase) => ({ phase }))),
    );
    expect(phases).toEqual([
      'starting',
      'starting',
      'generating',
      'validating',
      'repairing',
      'validating',
      'validating',
      'completed',
    ]);
    expect(activityPhase([])).toBe('starting');
  });

  it('ends as failed, stopped or completed', () => {
    expect(activityPhase([{ phase: 'failed' }])).toBe('failed');
    expect(activityPhase([{ phase: 'timedOut' }])).toBe('failed');
    expect(activityPhase([{ phase: 'cancelled' }])).toBe('cancelled');
    expect(ACTIVITY_PHASES.filter((phase) => isFinalPhase(phase))).toEqual([
      'completed',
      'failed',
      'cancelled',
    ]);
  });

  it('formats short and long runs', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(59_999)).toBe('0:59');
    expect(formatElapsed(61_000)).toBe('1:01');
    expect(formatElapsed(3_600_000 + 5 * 60_000 + 9_000)).toBe('1:05:09');
    expect(formatElapsed(-5)).toBe('0:00');
  });

  it('builds a timeline without repeated messages', () => {
    const timeline = buildTimeline(
      [
        at('preparing', 'Preparing the request', 0),
        at('generating', 'Claude is thinking', 2),
        at('generating', 'Claude is thinking', 3),
        at('generating', 'Claude is writing the Komas', 9),
        at('succeeded', 'The response is valid', 70),
      ],
      START,
    );
    expect(timeline).toEqual([
      { phase: 'starting', message: 'Preparing the request', offset: 0 },
      { phase: 'generating', message: 'Claude is thinking', offset: 2000 },
      { phase: 'generating', message: 'Claude is writing the Komas', offset: 9000 },
      { phase: 'completed', message: 'The response is valid', offset: 70_000 },
    ]);
  });
});
