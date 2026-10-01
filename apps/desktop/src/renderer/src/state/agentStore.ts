/** State of provider detection and agent executions. Nothing here is saved with the project. */
import type {
  AgentError,
  ExecutionDiagnostics,
  ExecutionStatusEvent,
  ProviderModelListing,
} from '@koma-motion/agent-runtime';
import { create } from 'zustand';
import type { IpcResponse } from '../../../shared/ipc';

export type DetectedProvider = IpcResponse<'koma:providers:detect'>['providers'][number];

export interface RunningExecution {
  readonly executionId: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly cancelRequested: boolean;
  readonly events: readonly ExecutionStatusEvent[];
}

export type ConversationEntry =
  | { readonly id: number; readonly kind: 'request'; readonly text: string }
  | {
      readonly id: number;
      readonly kind: 'result';
      readonly providerName: string;
      readonly text: string;
      readonly warnings: readonly string[];
    }
  | {
      readonly id: number;
      readonly kind: 'notApplied';
      readonly providerName: string;
      readonly text: string;
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
    execution: Omit<RunningExecution, 'events' | 'cancelRequested'>,
  ) => void;
  readonly addStatus: (event: ExecutionStatusEvent) => void;
  readonly requestCancel: () => void;
  /** Clears the execution only when it is still the one identified by `executionId`. */
  readonly finishExecution: (executionId: string) => void;
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
  conversation: [],
  modelListings: {},
  rememberedModels: {},

  setDetection(detection, providers) {
    set((state) => ({ detection, providers: providers ?? state.providers }));
  },
  startExecution(execution) {
    set({ execution: { ...execution, events: [], cancelRequested: false } });
  },
  addStatus(event) {
    set((state) =>
      state.execution?.executionId === event.executionId
        ? { execution: { ...state.execution, events: [...state.execution.events, event] } }
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
  finishExecution(executionId) {
    set((state) => (state.execution?.executionId === executionId ? { execution: null } : state));
  },
  addEntry(entry) {
    set((state) => ({
      conversation: [...state.conversation, { ...entry, id: nextEntryId++ }],
    }));
  },
  clearConversation() {
    set({ conversation: [] });
  },
  setModelListing(providerId, listing) {
    set((state) => ({ modelListings: { ...state.modelListings, [providerId]: listing } }));
  },
  rememberModel(key, model) {
    set((state) => ({ rememberedModels: { ...state.rememberedModels, [key]: model } }));
  },
}));
