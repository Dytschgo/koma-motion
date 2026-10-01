/** State of provider detection and agent executions. Nothing here is saved with the project. */
import type {
  AgentError,
  ExecutionDiagnostics,
  ExecutionOutputEvent,
  ExecutionStatusEvent,
  ProviderModelListing,
} from '@koma-motion/agent-runtime';
import { create } from 'zustand';
import type { IpcResponse } from '../../../shared/ipc';
import {
  appendStreamedOutput,
  EMPTY_STREAMED_OUTPUT,
  type StreamedOutput,
} from '../lib/streamedOutput';

export type DetectedProvider = IpcResponse<'koma:providers:detect'>['providers'][number];

export interface RunningExecution {
  readonly executionId: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly cancelRequested: boolean;
  readonly events: readonly ExecutionStatusEvent[];
  /** Whether the provider streams what it writes. Others report phases only. */
  readonly streams: boolean;
  /** Text the provider wrote for the user so far, bounded. */
  readonly output: StreamedOutput;
  /** The model the run was started with, in words, for example "opus". */
  readonly modelLabel: string;
  /** When the window started the run, in milliseconds since the epoch. */
  readonly startedAt: number;
}

/** How a run ended, as the window saw it. */
export type RunResult = 'completed' | 'failed' | 'cancelled';

/** A run that ended. It stays until the next run or another project. */
export interface FinishedRun extends RunningExecution {
  readonly finishedAt: number;
  readonly result: RunResult;
}

export type ConversationEntry =
  | {
      readonly id: number;
      readonly kind: 'request';
      readonly text: string;
      readonly referenceNames?: readonly string[];
    }
  | {
      readonly id: number;
      readonly kind: 'result';
      readonly providerName: string;
      readonly text: string;
      /** What the provider wrote while it worked, if it streams. */
      readonly output?: string;
      readonly warnings: readonly string[];
    }
  | {
      readonly id: number;
      readonly kind: 'notApplied';
      readonly providerName: string;
      readonly text: string;
      readonly output?: string;
    }
  | {
      readonly id: number;
      readonly kind: 'failure';
      readonly providerName: string;
      readonly status: 'failed' | 'cancelled' | 'timedOut';
      readonly error: AgentError;
      readonly diagnostics: ExecutionDiagnostics;
      /** The request that failed, so it can be sent again. */
      readonly request: string;
      readonly output?: string;
    };

type NewEntry = ConversationEntry extends infer Entry
  ? Entry extends ConversationEntry
    ? Omit<Entry, 'id'>
    : never
  : never;

interface AgentState {
  readonly providers: readonly DetectedProvider[];
  readonly detection: 'idle' | 'running' | 'done' | 'failed';
  readonly execution: RunningExecution | null;
  /** The last run that ended, so its outcome and monitor stay available. */
  readonly lastRun: FinishedRun | null;
  readonly conversation: readonly ConversationEntry[];
  /** Models a provider's CLI listed for the signed-in account, per provider. */
  readonly modelListings: Readonly<Record<string, ProviderModelListing | 'loading'>>;
  /**
   * A model id chosen before Default, per project and provider, so it can be
   * chosen again. Kept for the session only.
   */
  readonly rememberedModels: Readonly<Record<string, string>>;

  readonly setDetection: (
    detection: AgentState['detection'],
    providers?: readonly DetectedProvider[],
  ) => void;
  readonly startExecution: (
    execution: Omit<RunningExecution, 'events' | 'cancelRequested' | 'output' | 'startedAt'>,
  ) => void;
  readonly addStatus: (event: ExecutionStatusEvent) => void;
  /** Ignored unless the event belongs to the running execution. */
  readonly addOutput: (event: ExecutionOutputEvent) => void;
  readonly requestCancel: () => void;
  /** Clears the execution only when it is still the one identified by `executionId`. */
  readonly finishExecution: (executionId: string, result: RunResult) => void;
  readonly addEntry: (entry: NewEntry) => void;
  readonly clearConversation: () => void;
  readonly setModelListing: (providerId: string, listing: ProviderModelListing | 'loading') => void;
  readonly rememberModel: (key: string, model: string) => void;
}

let nextEntryId = 1;

export const useAgentStore = create<AgentState>((set) => ({
  providers: [],
  detection: 'idle',
  execution: null,
  lastRun: null,
  conversation: [],
  modelListings: {},
  rememberedModels: {},

  setDetection(detection, providers) {
    set((state) => ({ detection, providers: providers ?? state.providers }));
  },
  startExecution(execution) {
    set({
      execution: {
        ...execution,
        events: [],
        cancelRequested: false,
        output: EMPTY_STREAMED_OUTPUT,
        startedAt: Date.now(),
      },
      lastRun: null,
    });
  },
  addStatus(event) {
    set((state) =>
      state.execution?.executionId === event.executionId
        ? { execution: { ...state.execution, events: [...state.execution.events, event] } }
        : state,
    );
  },
  addOutput(event) {
    set((state) =>
      state.execution?.executionId === event.executionId
        ? {
            execution: {
              ...state.execution,
              output: appendStreamedOutput(state.execution.output, event),
            },
          }
        : state,
    );
  },
  requestCancel() {
    set((state) =>
      state.execution === null
        ? state
        : { execution: { ...state.execution, cancelRequested: true } },
    );
  },
  finishExecution(executionId, result) {
    set((state) =>
      state.execution?.executionId === executionId
        ? { execution: null, lastRun: { ...state.execution, finishedAt: Date.now(), result } }
        : state,
    );
  },
  addEntry(entry) {
    set((state) => ({
      conversation: [...state.conversation, { ...entry, id: nextEntryId++ }],
    }));
  },
  clearConversation() {
    set({ conversation: [], lastRun: null });
  },
  setModelListing(providerId, listing) {
    set((state) => ({ modelListings: { ...state.modelListings, [providerId]: listing } }));
  },
  rememberModel(key, model) {
    set((state) => ({ rememberedModels: { ...state.rememberedModels, [key]: model } }));
  },
}));
