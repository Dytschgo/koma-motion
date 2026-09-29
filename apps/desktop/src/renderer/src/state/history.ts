/**
 * Undo history as immutable snapshots. Documents are small and every change
 * creates a new document, so keeping snapshots is simple and reliable.
 */
export const HISTORY_LIMIT = 100;
/** Changes with the same key within this time become one undo step. */
export const COALESCE_WINDOW_MS = 1200;

export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
  /** Key and time of the last change, used to merge a series of small edits. */
  readonly lastChange: { readonly key: string; readonly time: number } | null;
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastChange: null };
}

export function commit<T>(
  history: History<T>,
  next: T,
  options: { readonly coalesceKey?: string | undefined; readonly time: number },
): History<T> {
  if (Object.is(next, history.present)) {
    return history;
  }
  const { coalesceKey, time } = options;
  const merges =
    coalesceKey !== undefined &&
    history.lastChange?.key === coalesceKey &&
    time - history.lastChange.time <= COALESCE_WINDOW_MS &&
    history.past.length > 0;
  return {
    past: merges ? history.past : [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
    lastChange: coalesceKey === undefined ? null : { key: coalesceKey, time },
  };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) {
    return history;
  }
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    lastChange: null,
  };
}

export function redo<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) {
    return history;
  }
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
    lastChange: null,
  };
}
