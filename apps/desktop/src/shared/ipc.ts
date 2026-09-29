/**
 * The complete contract between the renderer and the main process.
 *
 * Every channel has a schema for its request and its response. The main
 * process validates requests before it acts and responses before it sends
 * them; the renderer validates responses before it uses them. There is no
 * generic channel: what is not listed here cannot be asked of the main process.
 */
import {
  agentErrorSchema,
  executionDiagnosticsSchema,
  executionStatusEventSchema,
  generationInputSchema,
  providerDetectionResultSchema,
  providerMetadataSchema,
} from '@koma-motion/agent-runtime';
import {
  assetReferenceSchema,
  generationHistoryEntrySchema,
  komaProjectSchema,
  presentationSchema,
  providerIdSchema,
} from '@koma-motion/core';
import { z } from 'zod';

export const API_KEY = 'komaMotion';

const empty = z.object({}).strict();
const executionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

const failure = z.object({
  status: z.literal('failed'),
  /** A sentence that can be shown to the user as it is. */
  message: z.string(),
});
const cancelled = z.object({ status: z.literal('cancelled') });

/** What the renderer may know about the file of a project: names for display only. */
const fileInfo = z.object({
  fileName: z.string(),
  /** Shown to the user. The renderer cannot use it to read or write files. */
  displayPath: z.string(),
});

const generationOutcome = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('succeeded'),
    presentation: presentationSchema,
    historyEntry: generationHistoryEntrySchema,
    warnings: z.array(z.string()),
    repaired: z.boolean(),
    diagnostics: executionDiagnosticsSchema,
  }),
  z.object({
    status: z.enum(['failed', 'cancelled', 'timedOut']),
    error: agentErrorSchema,
    historyEntry: generationHistoryEntrySchema,
    diagnostics: executionDiagnosticsSchema,
  }),
]);

export const ipcContract = {
  'koma:project:create': {
    request: z.object({ name: z.string().trim().min(1).max(200) }).strict(),
    response: z.object({ project: komaProjectSchema }),
  },
  'koma:project:open': {
    request: empty,
    response: z.discriminatedUnion('status', [
      z.object({
        status: z.literal('opened'),
        project: komaProjectSchema,
        file: fileInfo,
        warnings: z.array(z.string()),
      }),
      cancelled,
      failure,
    ]),
  },
  'koma:project:save': {
    request: z.object({ project: komaProjectSchema }).strict(),
    response: z.discriminatedUnion('status', [
      z.object({ status: z.literal('saved'), project: komaProjectSchema, file: fileInfo }),
      cancelled,
      failure,
    ]),
  },
  'koma:project:save-as': {
    request: z.object({ project: komaProjectSchema }).strict(),
    response: z.discriminatedUnion('status', [
      z.object({ status: z.literal('saved'), project: komaProjectSchema, file: fileInfo }),
      cancelled,
      failure,
    ]),
  },
  'koma:brand-kit:select-logo': {
    request: empty,
    response: z.discriminatedUnion('status', [
      z.object({ status: z.literal('selected'), asset: assetReferenceSchema }),
      cancelled,
      failure,
    ]),
  },
  'koma:providers:detect': {
    request: empty,
    response: z.object({
      providers: z.array(
        z.object({ metadata: providerMetadataSchema, detection: providerDetectionResultSchema }),
      ),
    }),
  },
  'koma:providers:execute': {
    request: z
      .object({
        executionId: executionIdSchema,
        providerId: providerIdSchema,
        project: komaProjectSchema,
        input: generationInputSchema,
      })
      .strict(),
    response: generationOutcome,
  },
  'koma:providers:cancel': {
    request: z.object({ executionId: executionIdSchema }).strict(),
    response: z.object({ cancelled: z.boolean() }),
  },
  'koma:app:set-unsaved-changes': {
    request: z.object({ hasUnsavedChanges: z.boolean() }).strict(),
    response: empty,
  },
  'koma:app:confirm-close': {
    request: empty,
    response: empty,
  },
  'koma:app:get-info': {
    request: empty,
    response: z.object({
      version: z.string(),
      platform: z.enum(['windows', 'macos', 'other']),
      exporters: z.array(
        z.object({
          id: z.string(),
          displayName: z.string(),
          available: z.boolean(),
          note: z.string(),
        }),
      ),
    }),
  },
} as const;

export type IpcChannel = keyof typeof ipcContract;
export type IpcRequest<C extends IpcChannel> = z.input<(typeof ipcContract)[C]['request']>;
export type IpcResponse<C extends IpcChannel> = z.output<(typeof ipcContract)[C]['response']>;

export const IPC_CHANNELS = Object.keys(ipcContract) as readonly string[] as readonly IpcChannel[];

/** Events sent from the main process to the renderer. */
export const ipcEvents = {
  'koma:providers:status': executionStatusEventSchema,
  /** The window is about to close and the user chose to save first. */
  'koma:app:save-and-close': empty,
} as const;

export type IpcEventChannel = keyof typeof ipcEvents;
export type IpcEventPayload<C extends IpcEventChannel> = z.output<(typeof ipcEvents)[C]>;

export type GenerationOutcome = z.output<typeof generationOutcome>;
export type ProjectFileInfo = z.output<typeof fileInfo>;

/**
 * The preload script forwards requests without interpreting them. Payloads
 * cross the bridge as `unknown`; both sides validate them with the schemas above.
 */
export interface KomaMotionBridge {
  invoke(channel: IpcChannel, request: unknown): Promise<unknown>;
  /** Subscribes to an event. Returns the function that ends the subscription. */
  subscribe(channel: IpcEventChannel, listener: (payload: unknown) => void): () => void;
}
