/**
 * The text a provider streams into the chat while it works. Pure functions,
 * so the limits can be tested without a window.
 */
import type { ExecutionOutputEvent } from '@koma-motion/agent-runtime';

/**
 * Most characters the chat keeps for one run. Older text is dropped first, so
 * the newest words stay visible and the window's memory stays bounded.
 */
export const MAX_STREAMED_CHARACTERS = 16_000;

export interface StreamedOutput {
  /** The attempt the text belongs to; a repair attempt starts over. */
  readonly attempt: number;
  readonly text: string;
  /** Whether older text of this attempt was dropped. */
  readonly truncated: boolean;
}

export const EMPTY_STREAMED_OUTPUT: StreamedOutput = { attempt: 1, text: '', truncated: false };

/** Adds one output event. Text of an earlier attempt is ignored. */
export function appendStreamedOutput(
  current: StreamedOutput,
  event: Pick<ExecutionOutputEvent, 'attempt' | 'text'>,
  limit = MAX_STREAMED_CHARACTERS,
): StreamedOutput {
  if (event.attempt < current.attempt) {
    return current;
  }
  const base = event.attempt > current.attempt ? EMPTY_STREAMED_OUTPUT : current;
  const text = base.text + event.text;
  if (text.length <= limit) {
    return { attempt: event.attempt, text, truncated: base.truncated };
  }
  // Cut at a word boundary near the limit when there is one.
  const cut = text.length - limit;
  const space = text.indexOf(' ', cut);
  const start = space !== -1 && space - cut < 40 ? space + 1 : cut;
  return { attempt: event.attempt, text: text.slice(start), truncated: true };
}
