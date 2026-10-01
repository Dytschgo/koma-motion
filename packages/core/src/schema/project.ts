import { z } from 'zod';
import { idSchema } from '../ids';
import { assetReferenceSchema } from './asset';
import { brandKitSchema } from './brandKit';
import { findProjectLimitIssue } from './limits';
import { presentationSchema } from './presentation';

export {
  MAX_EXTENSION_DEPTH,
  MAX_EXTENSION_KEY_LENGTH,
  MAX_EXTENSION_NODES,
  MAX_EXTENSION_OBJECT_KEYS,
  MAX_PROJECT_FILE_BYTES,
  PROJECT_TOO_LARGE_MESSAGE,
  exceedsUtf8ByteLength,
} from './limits';

export const PROJECT_FORMAT = 'koma-motion-project';
export const CURRENT_SCHEMA_VERSION = 3;

/** UTF-16 code units, matching JavaScript/editor length. Reject rather than truncate. */
export const MAX_SYSTEM_INSTRUCTIONS_LENGTH = 8000;
export const systemInstructionsSchema = z.string().max(MAX_SYSTEM_INSTRUCTIONS_LENGTH, {
  message: `Use at most ${String(MAX_SYSTEM_INSTRUCTIONS_LENGTH)} characters for instructions. Your text has been kept.`,
});

export const GENERATION_STATUSES = ['succeeded', 'failed', 'cancelled', 'timedOut'] as const;
export const generationStatusSchema = z.enum(GENERATION_STATUSES);
export type GenerationStatus = z.infer<typeof generationStatusSchema>;

const timestampSchema = z.iso.datetime({ offset: true });

export const providerIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,39}$/, 'Provider id must be lowercase letters, digits or "-"');

/** Passed to a CLI as a single argument, so the alphabet is restricted. */
export const modelNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/, 'Model name contains unsupported characters');

export const MIN_AGENT_TIMEOUT_SECONDS = 10;
/** Largest whole-second delay supported by a signed 32-bit JavaScript timer. */
export const MAX_AGENT_TIMEOUT_SECONDS = Math.floor(2_147_483_647 / 1000);

export const agentConfigurationSchema = z.object({
  selectedProviderId: providerIdSchema,
  /** Image generation is opt-in and uses the existing Codex CLI sign-in. */
  imageGeneration: z.enum(['off', 'codex', 'grok']).optional(),
  /** null means run until completion or cancellation. */
  timeoutSeconds: z
    .number()
    .int()
    .min(MIN_AGENT_TIMEOUT_SECONDS)
    .max(MAX_AGENT_TIMEOUT_SECONDS)
    .nullable(),
  providers: z.record(
    providerIdSchema,
    z.object({
      /** `null` lets the provider use its own default model. */
      model: modelNameSchema.nullable(),
    }),
  ),
});

/** A concise local record of one generation request. It never stores model reasoning. */
export const generationHistoryEntrySchema = z.object({
  id: idSchema,
  createdAt: timestampSchema,
  providerId: providerIdSchema,
  userRequest: z.string(),
  status: generationStatusSchema,
  summary: z.string().max(2000),
  warnings: z.array(z.string().max(1000)).max(100),
});

export const MAX_HISTORY_ENTRIES = 200;
export const MAX_PROJECT_ASSETS = 500;

/**
 * The root of a `.koma` project. Unknown top-level properties are kept so
 * that data written by a newer minor revision survives a round trip, when
 * that data is JSON and the whole document fits in {@link MAX_PROJECT_FILE_BYTES}.
 */
const projectShape = {
  format: z.literal(PROJECT_FORMAT),
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: idSchema,
  name: z.string().min(1).max(200),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  brandKit: brandKitSchema,
  presentation: presentationSchema,
  assets: z.array(assetReferenceSchema).max(MAX_PROJECT_ASSETS),
  agentConfiguration: agentConfigurationSchema,
  systemInstructions: systemInstructionsSchema.default(''),
  generationHistory: z.array(generationHistoryEntrySchema).max(MAX_HISTORY_ENTRIES),
};

const KNOWN_PROJECT_KEYS = new Set(Object.keys(projectShape));

export const komaProjectSchema = z.looseObject(projectShape).superRefine((project, context) => {
  const assetIds = new Set<string>();
  project.assets.forEach((asset, index) => {
    if (assetIds.has(asset.id)) {
      context.addIssue({
        code: 'custom',
        path: ['assets', index, 'id'],
        message: `Asset id "${asset.id}" is used more than once`,
      });
    }
    assetIds.add(asset.id);
  });

  const extensionIssue = findProjectLimitIssue(project, KNOWN_PROJECT_KEYS);
  if (extensionIssue !== null) {
    context.addIssue({
      code: 'custom',
      path: [...extensionIssue.path],
      message: extensionIssue.message,
    });
  }
});

export type AgentConfiguration = z.infer<typeof agentConfigurationSchema>;
export type GenerationHistoryEntry = z.infer<typeof generationHistoryEntrySchema>;
export type KomaProject = z.infer<typeof komaProjectSchema>;
