import { modelNameSchema, reasoningValueSchema } from '@koma-motion/core';
import { z } from 'zod';
import {
  providerModelListingSchema,
  type AgentExecutionContext,
  type DiscoveredModel,
  type ProviderModelListing,
  type ReasoningChoices,
} from '../providers/types';
import type { CliEnvironment } from './cliEnvironment';

const label = z.string().min(1).max(80);
const description = z.string().max(1000);
const unsupported = { status: 'unsupported' } as const;
const claudeModels = z
  .array(
    z.object({
      value: modelNameSchema,
      displayName: label,
      resolvedModel: modelNameSchema.optional(),
      supportsEffort: z.boolean().optional(),
      supportedEffortLevels: z.array(reasoningValueSchema).max(50).optional(),
    }),
  )
  .max(200);
const codexPage = z.object({
  data: z
    .array(
      z.object({
        model: modelNameSchema,
        displayName: label,
        hidden: z.boolean().optional(),
        isDefault: z.boolean(),
        supportedReasoningEfforts: z
          .array(z.object({ reasoningEffort: reasoningValueSchema, description }))
          .max(50)
          .optional(),
        defaultReasoningEffort: reasoningValueSchema.nullish(),
      }),
    )
    .max(200),
  nextCursor: z.string().min(1).max(2000).nullable(),
});
const grokModels = z.object({
  currentModelId: modelNameSchema,
  availableModels: z
    .array(
      z.object({
        modelId: modelNameSchema,
        name: label,
        _meta: z
          .object({
            supportsReasoningEffort: z.boolean().optional(),
            reasoningEffort: reasoningValueSchema.optional(),
            reasoningEfforts: z
              .array(
                z.object({
                  id: reasoningValueSchema,
                  value: reasoningValueSchema,
                  label,
                  description: description.optional(),
                  default: z.boolean().optional(),
                }),
              )
              .max(50)
              .optional(),
          })
          .optional(),
      }),
    )
    .max(200),
});

export function parseClaudeModels(value: unknown): {
  models: DiscoveredModel[];
  defaultModel: string | null;
} {
  const entries = claudeModels.parse(value);
  return {
    // Keep the CLI's selectable token, including aliases; never guess a resolved ID.
    models: entries
      .filter((entry) => entry.value !== 'default')
      .map((entry) => ({
        id: entry.value,
        label: entry.displayName,
        reasoning:
          entry.supportsEffort && entry.supportedEffortLevels?.length
            ? {
                status: 'supported',
                choices: entry.supportedEffortLevels.map((value) => ({ value, label: value })),
                defaultValue: null,
              }
            : unsupported,
      })),
    // This is informative only: a null model still omits --model.
    defaultModel: entries.find((entry) => entry.value === 'default')?.resolvedModel ?? null,
  };
}

export function parseCodexModels(value: unknown): {
  models: DiscoveredModel[];
  defaultModel: string | null;
  nextCursor: string | null;
} {
  const page = codexPage.parse(value);
  return {
    models: page.data
      .filter((entry) => !entry.hidden)
      .map((entry) => ({
        id: entry.model,
        label: entry.displayName,
        reasoning: entry.supportedReasoningEfforts?.length
          ? {
              status: 'supported',
              choices: entry.supportedReasoningEfforts.map((option) => ({
                value: option.reasoningEffort,
                label: option.reasoningEffort,
                description: option.description,
              })),
              defaultValue: entry.defaultReasoningEffort ?? null,
            }
          : unsupported,
      })),
    defaultModel: page.data.find((entry) => entry.isDefault && !entry.hidden)?.model ?? null,
    nextCursor: page.nextCursor,
  };
}

export function parseGrokModels(value: unknown): {
  models: DiscoveredModel[];
  defaultModel: string | null;
} {
  const state = grokModels.parse(value);
  return {
    models: state.availableModels.map((entry) => {
      const meta = entry._meta;
      const options = meta?.reasoningEfforts;
      const reasoning: ReasoningChoices =
        meta?.supportsReasoningEffort && options?.length
          ? {
              status: 'supported',
              choices: options.map((option) => ({
                value: option.id,
                label: option.label,
                ...(option.description === undefined ? {} : { description: option.description }),
              })),
              defaultValue:
                options.find((option) => option.value === meta.reasoningEffort)?.id ??
                options.find((option) => option.default)?.id ??
                null,
            }
          : unsupported;
      return { id: entry.modelId, label: entry.name, reasoning };
    }),
    defaultModel: state.currentModelId,
  };
}

const record = z.record(z.string(), z.unknown());
const rpcResponse = z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number() }).optional(),
});
const claudeResponse = z.object({
  type: z.literal('control_response'),
  response: z.object({
    request_id: z.literal('koma-models'),
    subtype: z.string(),
    response: z.object({ models: z.unknown().optional() }).optional(),
  }),
});
export type CapabilityProtocol = 'claude' | 'codex' | 'grok';

/** A bounded metadata-only conversation. No thread, session, user prompt or tool request is sent. */
export async function discoverModels(
  environment: CliEnvironment,
  protocol: CapabilityProtocol,
  args: readonly string[],
  signal: AbortSignal,
): Promise<ProviderModelListing> {
  const name = protocol === 'claude' ? 'Claude Code' : protocol === 'codex' ? 'Codex CLI' : 'Grok';
  const failed = (
    message = `${name} could not report model capabilities. Retry or use the CLI default.`,
  ): ProviderModelListing => ({ status: 'failed', message });
  const executable = await environment.resolveExecutable(protocol);
  if (executable === null)
    return failed(`${name} is not installed. You can still save a default or custom model choice.`);
  const directory = await environment.createWorkingDirectory();
  const completed = new AbortController();
  const deadline = AbortSignal.timeout(20_000);
  let result: ProviderModelListing | undefined;
  let pending = '';
  let nextId = 2;
  let expectedId = 1;
  const cursors = new Set<string>();
  const models: DiscoveredModel[] = [];
  let defaultModel: string | null = null;
  const encode = (value: unknown): string => `${JSON.stringify(value)}\n`;
  const rpc = (id: number, method: string, params: unknown): string =>
    encode({ jsonrpc: '2.0', id, method, params });
  const first =
    protocol === 'claude'
      ? encode({
          type: 'control_request',
          request_id: 'koma-models',
          request: { subtype: 'initialize', hooks: {} },
        })
      : rpc(
          1,
          'initialize',
          protocol === 'codex'
            ? { clientInfo: { name: 'koma_motion', version: '0.1.1' } }
            : {
                protocolVersion: 1,
                clientCapabilities: {
                  fs: { readTextFile: false, writeTextFile: false },
                  terminal: false,
                },
                clientInfo: { name: 'koma-motion', version: '0.1.1' },
              },
        );
  const finish = (value: ProviderModelListing): void => {
    result = value;
    completed.abort();
  };
  const listed = (data: {
    models: DiscoveredModel[];
    defaultModel: string | null;
  }): ProviderModelListing => {
    if (new Set(data.models.map((model) => model.id)).size !== data.models.length)
      throw new Error('Duplicate model');
    if (
      data.defaultModel !== null &&
      !data.models.some((model) => model.id === data.defaultModel) &&
      protocol !== 'claude'
    )
      throw new Error('Missing default');
    return providerModelListingSchema.parse({
      status: 'listed',
      ...data,
      checkedAt: environment.now().toISOString(),
    });
  };
  try {
    const outcome = await environment.runProcess({
      executable,
      arguments: args,
      input: first,
      keepInputOpen: true,
      workingDirectory: directory,
      signal: AbortSignal.any([signal, deadline, completed.signal]),
      maxOutputBytes: 512 * 1024,
      env:
        protocol === 'claude'
          ? environment.claudeCodeChildEnvironment()
          : environment.childEnvironment(protocol),
      onStandardOutput: (text, write) => {
        if (result !== undefined) return;
        pending += text;
        let end: number;
        while ((end = pending.indexOf('\n')) !== -1 && result === undefined) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          try {
            const message: unknown = JSON.parse(line);
            if (protocol === 'claude') {
              const parsed = claudeResponse.safeParse(message);
              if (!parsed.success) continue;
              if (parsed.data.response.subtype !== 'success') {
                finish(failed());
                continue;
              }
              const data = parsed.data.response.response;
              finish(
                data?.models === undefined ? unsupported : listed(parseClaudeModels(data.models)),
              );
              continue;
            }
            const parsed = rpcResponse.safeParse(message);
            if (!parsed.success || parsed.data.id !== expectedId) continue;
            if (parsed.data.error) {
              finish(parsed.data.error.code === -32601 ? unsupported : failed());
              continue;
            }
            if (parsed.data.id === 1) {
              // Validate the initialization envelope, without forwarding account data.
              record.parse(parsed.data.result);
              expectedId = nextId;
              if (protocol === 'codex') write(encode({ method: 'initialized' }));
              write(
                rpc(
                  nextId,
                  protocol === 'codex' ? 'model/list' : '_x.ai/models/list',
                  protocol === 'codex' ? { includeHidden: false, limit: 100 } : {},
                ),
              );
            } else if (protocol === 'codex') {
              const page = parseCodexModels(parsed.data.result);
              models.push(...page.models);
              defaultModel ??= page.defaultModel;
              if (models.length > 200) throw new Error('Too many models');
              if (page.nextCursor === null) finish(listed({ models, defaultModel }));
              else {
                if (cursors.has(page.nextCursor) || cursors.size >= 20)
                  throw new Error('Invalid pagination');
                cursors.add(page.nextCursor);
                nextId += 1;
                expectedId = nextId;
                write(
                  rpc(nextId, 'model/list', {
                    includeHidden: false,
                    limit: 100,
                    cursor: page.nextCursor,
                  }),
                );
              }
            } else {
              const envelope = record.parse(parsed.data.result);
              if (envelope['error']) throw new Error('Listing failed');
              finish(listed(parseGrokModels(envelope['result'])));
            }
          } catch {
            finish(
              failed(
                `${name} returned unreadable model capabilities. Retry after updating the CLI, or use its default.`,
              ),
            );
          }
        }
      },
    });
    if (signal.aborted || deadline.aborted)
      return failed(
        `${name} capability discovery was stopped or timed out. Retry or use the CLI default.`,
      );
    if (outcome.outputLimitExceeded || outcome.startError !== null) return failed();
    if (result) return result;
    if (/unexpected argument|unknown option|unrecognized subcommand/i.test(outcome.standardError))
      return unsupported;
    return failed();
  } catch {
    return failed();
  } finally {
    await environment.removeWorkingDirectory(directory).catch(() => undefined);
  }
}

/** Never send a saved override on the strength of renderer state or a past discovery. */
export async function validatedReasoning(
  context: AgentExecutionContext,
  list: (signal: AbortSignal) => Promise<ProviderModelListing>,
): Promise<string | null> {
  if (!context.reasoning || context.model === null) return null;
  let listing: ProviderModelListing;
  try {
    listing = providerModelListingSchema.parse(await list(context.signal));
  } catch {
    listing = { status: 'failed', message: 'Capabilities could not be checked.' };
  }
  const reasoning =
    listing.status === 'listed'
      ? listing.models.find((model) => model.id === context.model)?.reasoning
      : undefined;
  if (
    reasoning?.status === 'supported' &&
    reasoning.choices.some((choice) => choice.value === context.reasoning)
  )
    return context.reasoning;
  const warning =
    'The saved reasoning preference could not be confirmed for this model. This run uses the CLI default reasoning.';
  context.reportProgress(warning);
  context.reportWarning?.(warning);
  return null;
}
