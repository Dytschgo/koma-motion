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
  brandKitLogoDataSchema,
  MAX_SAVED_BRAND_KITS,
  savedBrandKitLogoSchema,
  savedBrandKitNameSchema,
  savedBrandKitSchema,
} from '@koma-motion/brand-kit';
import {
  assetReferenceSchema,
  brandKitSchema,
  idSchema,
  generationHistoryEntrySchema,
  komaProjectSchema,
  presentationSchema,
  providerIdSchema,
} from '@koma-motion/core';
import { z } from 'zod';
import { updateChannelSchema, updateStatusSchema } from './updates';
import {
  instructionTemplateActionSchema,
  instructionTemplateLibrarySchema,
} from './instructionTemplates';

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

/** The outcome of an action that can fail with a message for the user. */
const actionResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('done') }),
  failure,
]);

/** A saved Brand Kit as the library shows it. `available` is false when its logo file is gone. */
const savedBrandKitSummary = savedBrandKitSchema.extend({
  logo: savedBrandKitLogoSchema.extend({ available: z.boolean() }).nullable(),
});

/**
 * The Brand Kit library after an action. `kitId` names the kit an action
 * created or changed. A library that cannot be read is reported, never
 * replaced: `canStartNew` offers to keep the file as a backup and start again.
 */
const brandKitLibraryState = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    kits: z.array(savedBrandKitSummary).max(MAX_SAVED_BRAND_KITS),
    /** Entries that could not be read. They stay in the file unchanged. */
    unreadableCount: z.number().int().nonnegative(),
    kitId: idSchema.nullable(),
  }),
  z.object({ status: z.literal('damaged'), message: z.string(), canStartNew: z.boolean() }),
  failure,
]);

/** Settings and logo bytes taken from the open project. */
const brandKitContent = {
  brandKit: brandKitSchema,
  logo: brandKitLogoDataSchema.nullable(),
};

export const ipcContract = {
  'koma:instruction-templates:list': {
    request: empty,
    response: z.discriminatedUnion('status', [
      z.object({
        status: z.literal('loaded'),
        templates: instructionTemplateLibrarySchema.shape.templates,
      }),
      failure,
    ]),
  },
  'koma:instruction-templates:change': {
    request: instructionTemplateActionSchema,
    response: z.discriminatedUnion('status', [
      z.object({
        status: z.literal('saved'),
        templates: instructionTemplateLibrarySchema.shape.templates,
      }),
      failure,
    ]),
  },
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
        migratedFrom: z.number().int().positive().nullable().optional(),
      }),
      cancelled,
      failure.extend({ diagnostics: z.string().optional() }),
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
    request: z
      .object({ project: komaProjectSchema, preserveOriginal: z.boolean().optional() })
      .strict(),
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
  'koma:project:select-image': {
    request: empty,
    response: z.discriminatedUnion('status', [
      z.object({ status: z.literal('selected'), asset: assetReferenceSchema }),
      cancelled,
      failure,
    ]),
  },
  'koma:brand-kits:list': {
    request: empty,
    response: brandKitLibraryState,
  },
  'koma:brand-kits:create': {
    request: z.object({ name: savedBrandKitNameSchema, ...brandKitContent }).strict(),
    response: brandKitLibraryState,
  },
  'koma:brand-kits:update': {
    request: z.object({ id: idSchema, ...brandKitContent }).strict(),
    response: brandKitLibraryState,
  },
  'koma:brand-kits:rename': {
    request: z.object({ id: idSchema, name: savedBrandKitNameSchema }).strict(),
    response: brandKitLibraryState,
  },
  'koma:brand-kits:duplicate': {
    request: z.object({ id: idSchema }).strict(),
    response: brandKitLibraryState,
  },
  'koma:brand-kits:delete': {
    request: z.object({ id: idSchema }).strict(),
    response: brandKitLibraryState,
  },
  'koma:brand-kits:load': {
    request: z.object({ id: idSchema }).strict(),
    response: z.discriminatedUnion('status', [
      z.object({
        status: z.literal('loaded'),
        kit: savedBrandKitSummary,
        logo: brandKitLogoDataSchema.nullable(),
        /** Set when the kit has a logo that could not be read from the library. */
        logoProblem: z.string().nullable(),
      }),
      failure,
    ]),
  },
  'koma:brand-kits:start-new': {
    request: empty,
    response: z.discriminatedUnion('status', [
      z.object({ status: z.literal('started'), backupFileName: z.string() }),
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
  'koma:updates:get-status': {
    request: empty,
    response: updateStatusSchema,
  },
  'koma:updates:check': {
    request: empty,
    response: actionResult,
  },
  'koma:updates:set-channel': {
    request: z.object({ channel: updateChannelSchema }).strict(),
    response: actionResult,
  },
  'koma:updates:download': {
    request: empty,
    response: actionResult,
  },
  'koma:updates:install': {
    request: empty,
    response: actionResult,
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
  /** The state of updating changed. */
  'koma:updates:status': updateStatusSchema,
} as const;

export type IpcEventChannel = keyof typeof ipcEvents;
export type IpcEventPayload<C extends IpcEventChannel> = z.output<(typeof ipcEvents)[C]>;

export type GenerationOutcome = z.output<typeof generationOutcome>;
export type ProjectFileInfo = z.output<typeof fileInfo>;
export type BrandKitLibraryState = z.output<typeof brandKitLibraryState>;
export type SavedBrandKitSummary = z.output<typeof savedBrandKitSummary>;

/**
 * The preload script forwards requests without interpreting them. Payloads
 * cross the bridge as `unknown`; both sides validate them with the schemas above.
 */
export interface KomaMotionBridge {
  invoke(channel: IpcChannel, request: unknown): Promise<unknown>;
  /** Subscribes to an event. Returns the function that ends the subscription. */
  subscribe(channel: IpcEventChannel, listener: (payload: unknown) => void): () => void;
}
