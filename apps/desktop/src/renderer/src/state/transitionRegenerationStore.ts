/**
 * Regeneration of single transitions. At most one runs at a time. The last
 * outcome of every other transition is kept so its warning can say what went
 * wrong and offer a retry. Nothing here is saved with the project.
 */
import { create } from 'zustand';

export type TransitionRegeneration =
  | {
      readonly status: 'running';
      readonly transitionId: string;
      readonly sessionId: number;
      readonly executionId: string;
      readonly providerName: string;
      /** The latest progress message of the provider. */
      readonly progress: string;
      readonly cancelRequested: boolean;
    }
  | {
      /** The transition was not changed. `message` says why, as a sentence for the user. */
      readonly status: 'failed' | 'cancelled' | 'discarded';
      readonly transitionId: string;
      readonly sessionId: number;
      readonly providerName: string;
      readonly message: string;
    };

interface TransitionRegenerationState {
  readonly entries: Readonly<Record<string, TransitionRegeneration>>;
  readonly start: (entry: Extract<TransitionRegeneration, { status: 'running' }>) => void;
  readonly progress: (executionId: string, message: string) => void;
  readonly requestCancel: (executionId: string) => void;
  /** Records how a regeneration ended, if it is still the one identified by `executionId`. */
  readonly finish: (
    executionId: string,
    outcome: Exclude<TransitionRegeneration, { status: 'running' }> | null,
  ) => void;
  readonly clear: (transitionId: string) => void;
}

export const useTransitionRegenerationStore = create<TransitionRegenerationState>((set) => ({
  entries: {},

  start(entry) {
    set((state) => ({ entries: { ...state.entries, [entry.transitionId]: entry } }));
  },
  progress(executionId, message) {
    set((state) => {
      const entry = Object.values(state.entries).find(
        (item) => item.status === 'running' && item.executionId === executionId,
      );
      return entry?.status === 'running'
        ? { entries: { ...state.entries, [entry.transitionId]: { ...entry, progress: message } } }
        : state;
    });
  },
  requestCancel(executionId) {
    set((state) => {
      const entry = Object.values(state.entries).find(
        (item) => item.status === 'running' && item.executionId === executionId,
      );
      return entry?.status === 'running'
        ? {
            entries: {
              ...state.entries,
              [entry.transitionId]: { ...entry, cancelRequested: true },
            },
          }
        : state;
    });
  },
  finish(executionId, outcome) {
    set((state) => {
      const entry = Object.values(state.entries).find(
        (item) => item.status === 'running' && item.executionId === executionId,
      );
      if (entry === undefined) {
        return state;
      }
      const { [entry.transitionId]: _finished, ...rest } = state.entries;
      return { entries: outcome === null ? rest : { ...rest, [entry.transitionId]: outcome } };
    });
  },
  clear(transitionId) {
    set((state) => {
      if (!(transitionId in state.entries)) {
        return state;
      }
      const { [transitionId]: _cleared, ...rest } = state.entries;
      return { entries: rest };
    });
  },
}));

/** The running regeneration of the open project, if any. */
export function selectRunningRegeneration(
  state: Pick<TransitionRegenerationState, 'entries'>,
  sessionId: number,
): Extract<TransitionRegeneration, { status: 'running' }> | null {
  for (const entry of Object.values(state.entries)) {
    if (entry.status === 'running' && entry.sessionId === sessionId) {
      return entry;
    }
  }
  return null;
}
