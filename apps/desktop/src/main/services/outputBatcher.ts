import { MAX_OUTPUT_EVENT_LENGTH, type ExecutionOutputEvent } from '@koma-motion/agent-runtime';

/** How often collected output is sent to the window, in milliseconds. */
export const OUTPUT_FLUSH_INTERVAL_MS = 50;

export interface OutputBatcher {
  readonly push: (event: ExecutionOutputEvent) => void;
  /** Sends what is collected now. */
  readonly flush: () => void;
  /** Sends what is collected and stops the timer. Later pushes are ignored. */
  readonly close: () => void;
}

/**
 * Collects streamed output of one execution and sends it in few, bounded
 * events: at most one per interval, none longer than the event limit, and a
 * new event whenever the attempt changes. This keeps IPC traffic and renderer
 * updates low while a provider writes many small pieces.
 */
export function createOutputBatcher(
  send: (event: ExecutionOutputEvent) => void,
  timers: {
    readonly set: (callback: () => void, delay: number) => unknown;
    readonly clear: (handle: unknown) => void;
  } = {
    set: (callback, delay) => setTimeout(callback, delay),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): OutputBatcher {
  let pending: { executionId: string; attempt: number; text: string } | null = null;
  let timer: unknown = null;
  let closed = false;

  const flush = (): void => {
    if (timer !== null) {
      timers.clear(timer);
      timer = null;
    }
    const batch = pending;
    pending = null;
    if (batch === null) return;
    for (let start = 0; start < batch.text.length; start += MAX_OUTPUT_EVENT_LENGTH) {
      send({
        executionId: batch.executionId,
        attempt: batch.attempt,
        text: batch.text.slice(start, start + MAX_OUTPUT_EVENT_LENGTH),
      });
    }
  };

  return {
    push(event) {
      if (closed || event.text === '') return;
      if (
        pending !== null &&
        (pending.executionId !== event.executionId || pending.attempt !== event.attempt)
      ) {
        flush();
      }
      if (pending === null) {
        pending = { executionId: event.executionId, attempt: event.attempt, text: '' };
      }
      pending.text += event.text;
      if (pending.text.length >= MAX_OUTPUT_EVENT_LENGTH) {
        flush();
      } else if (timer === null) {
        timer = timers.set(flush, OUTPUT_FLUSH_INTERVAL_MS);
      }
    },
    flush,
    close() {
      flush();
      closed = true;
    },
  };
}
