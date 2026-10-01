import { MAX_OUTPUT_EVENT_LENGTH, type ExecutionOutputEvent } from '@koma-motion/agent-runtime';
import { describe, expect, it } from 'vitest';
import { createOutputBatcher, OUTPUT_FLUSH_INTERVAL_MS } from './outputBatcher';

function manualTimers(): {
  readonly timers: Parameters<typeof createOutputBatcher>[1];
  readonly fire: () => void;
  readonly pending: () => number;
} {
  let queue: { callback: () => void; delay: number }[] = [];
  return {
    timers: {
      set: (callback, delay) => {
        const entry = { callback, delay };
        queue.push(entry);
        return entry;
      },
      clear: (handle) => {
        queue = queue.filter((entry) => entry !== handle);
      },
    },
    fire: () => {
      const current = queue;
      queue = [];
      for (const entry of current) {
        expect(entry.delay).toBe(OUTPUT_FLUSH_INTERVAL_MS);
        entry.callback();
      }
    },
    pending: () => queue.length,
  };
}

const piece = (text: string, attempt = 1, executionId = 'execution-1'): ExecutionOutputEvent => ({
  executionId,
  attempt,
  text,
});

describe('output batcher', () => {
  it('sends the pieces of one interval as one event', () => {
    const sent: ExecutionOutputEvent[] = [];
    const clock = manualTimers();
    const batcher = createOutputBatcher((event) => sent.push(event), clock.timers);
    batcher.push(piece('I will '));
    batcher.push(piece('create '));
    batcher.push(piece('three Komas.'));
    expect(sent).toEqual([]);
    expect(clock.pending()).toBe(1);
    clock.fire();
    expect(sent).toEqual([piece('I will create three Komas.')]);
  });

  it('starts a new event for a new attempt and splits long text', () => {
    const sent: ExecutionOutputEvent[] = [];
    const clock = manualTimers();
    const batcher = createOutputBatcher((event) => sent.push(event), clock.timers);
    batcher.push(piece('first'));
    batcher.push(piece('second', 2));
    batcher.push(piece('y'.repeat(MAX_OUTPUT_EVENT_LENGTH + 10), 2));
    expect(sent.map((event) => [event.attempt, event.text.length])).toEqual([
      [1, 5],
      [2, MAX_OUTPUT_EVENT_LENGTH],
      [2, 16],
    ]);
    expect(clock.pending()).toBe(0);
  });

  it('sends what is left when closed and ignores later pieces', () => {
    const sent: ExecutionOutputEvent[] = [];
    const clock = manualTimers();
    const batcher = createOutputBatcher((event) => sent.push(event), clock.timers);
    batcher.push(piece('last words'));
    batcher.close();
    expect(sent).toEqual([piece('last words')]);
    expect(clock.pending()).toBe(0);
    batcher.push(piece('late'));
    clock.fire();
    expect(sent).toHaveLength(1);
  });
});
