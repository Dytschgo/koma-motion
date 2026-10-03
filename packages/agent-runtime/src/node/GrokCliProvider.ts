import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { modelNameSchema, reasoningValueSchema } from '@koma-motion/core';
import { agentError } from '../contract/errors';
import type { PresentationGenerationRequest } from '../contract/request';
import type { TransitionRegenerationRequest } from '../contract/transition';
import type {
  AgentExecutionContext,
  AgentProvider,
  ProviderDetectionResult,
  ProviderExecutionResult,
  ProviderMetadata,
  ProviderModelListing,
} from '../providers/types';
import {
  createCliEnvironment,
  describeProcessFailure,
  detectCli,
  MAX_CLI_OUTPUT_BYTES,
  type CliEnvironment,
} from './cliEnvironment';
import { redactDiagnostics } from './redact';
import { discoverModels, validatedReasoning } from './modelCapabilities';

export const GROK_PROVIDER_ID = 'grok';
const EXECUTABLE_NAME = 'grok';
const PROMPT_FILE_NAME = 'prompt.txt';

/**
 * Arguments of the non-interactive invocation. Help was read from Grok 1.0.44
 * on Windows on 30 September 2026 (`grok --help`). The same argument list,
 * with a one-field schema, was run once on that installation and returned
 * JSON. See docs/AGENT_PROVIDERS.md.
 *
 * Grok does not read a prompt from standard input. The request is written to
 * a file Koma Motion creates in the empty temporary directory, and only that
 * path is an argument.
 *
 * - `--prompt-file` runs one turn and exits.
 * - `--output-format json` prints one JSON object.
 * - `--json-schema` constrains that object. It implies JSON output.
 * - `--verbatim` sends the prompt file as written.
 * - `--tools ""` allowlists no built-in tools.
 * - `--disable-web-search` removes web search and web fetch.
 * - `--no-subagents` disables subagent spawning.
 * - `--no-plan` disables plan mode.
 * - `--permission-mode dontAsk` does not prompt. Read-only tools that remain
 *   available can still run.
 * - `--sandbox strict` is the profile named by the installed sandbox guide.
 *   That guide lists enforcement for Linux and macOS. This Windows run
 *   accepted the flag and printed no sandbox error.
 * - `--cwd` is the empty temporary directory.
 *
 * `--no-auto-update` is accepted by this binary and described in the
 * installed headless guide, but it is not listed in `grok --help`, so it is
 * not passed. Standard error is redirected, which that guide treats as
 * non-interactive for update checks.
 */
export function buildGrokArguments(options: {
  readonly promptFile: string;
  readonly workingDirectory: string;
  readonly systemPrompt: string;
  readonly responseJsonSchema: string;
  readonly model: string | null;
  readonly reasoning?: string | null;
}): string[] {
  const model = options.model === null ? [] : ['--model', modelNameSchema.parse(options.model)];
  return [
    '--prompt-file',
    options.promptFile,
    '--output-format',
    'json',
    '--json-schema',
    options.responseJsonSchema,
    '--verbatim',
    '--tools',
    '',
    '--disable-web-search',
    '--no-subagents',
    '--no-plan',
    '--permission-mode',
    'dontAsk',
    '--sandbox',
    'strict',
    '--cwd',
    options.workingDirectory,
    ...model,
    ...(options.reasoning
      ? ['--reasoning-effort', reasoningValueSchema.parse(options.reasoning)]
      : []),
    '--system-prompt-override',
    options.systemPrompt,
  ];
}

interface GrokEnvelope {
  readonly isError: boolean;
  readonly result: string;
  readonly structuredOutput: unknown;
}

/**
 * Reads the JSON object printed by `--output-format json`.
 *
 * On Grok 1.0.44 the constrained answer is `structuredOutput` and the same
 * JSON is also in `text`. `thought` is ignored. A failure object is
 * `{ "type": "error", "message": "..." }`.
 */
export function parseGrokEnvelope(standardOutput: string): GrokEnvelope | null {
  let envelope: unknown;
  try {
    envelope = JSON.parse(standardOutput);
  } catch {
    return null;
  }
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
    return null;
  }
  const record: Readonly<Record<string, unknown>> = { ...envelope };
  if (record['type'] === 'error') {
    return {
      isError: true,
      result: typeof record['message'] === 'string' ? record['message'] : '',
      structuredOutput: undefined,
    };
  }
  const text = record['text'];
  const structuredOutput = record['structuredOutput'];
  if (typeof text !== 'string' && structuredOutput === undefined) {
    return null;
  }
  return {
    isError: false,
    result: typeof text === 'string' ? text : '',
    structuredOutput,
  };
}

/**
 * Reads the output of `grok models`. Grok 1.0.44 prints, for example:
 *
 * ```text
 * Default model: grok-4.7
 *
 * Available models:
 *   * grok-4.7 (default)
 *   - grok-4.6
 * ```
 *
 * Lines that do not look like a model entry are ignored, and every id must
 * be a valid model name. Returns `null` when no model could be read.
 */
export function parseGrokModelList(
  output: string,
): { readonly models: string[]; readonly defaultModel: string | null } | null {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*available models:\s*$/i.test(line));
  if (start === -1) {
    return null;
  }
  const models: string[] = [];
  let defaultModel: string | null = null;
  for (const line of lines.slice(start + 1)) {
    const match = /^\s*[*-]\s+(\S+)(\s+\(default\))?\s*$/.exec(line);
    if (match === null) {
      if (line.trim() === '') continue;
      break;
    }
    const id = match[1] ?? '';
    if (!modelNameSchema.safeParse(id).success || models.includes(id)) continue;
    models.push(id);
    if (match[2] !== undefined) defaultModel = id;
    if (models.length === 50) break;
  }
  if (defaultModel === null) {
    const stated = /^\s*default model:\s*(\S+)\s*$/im.exec(output)?.[1] ?? null;
    defaultModel = stated !== null && models.includes(stated) ? stated : null;
  }
  return models.length === 0 ? null : { models, defaultModel };
}

/** Generates presentations with a locally installed Grok CLI. */
export class GrokCliProvider implements AgentProvider {
  readonly id = GROK_PROVIDER_ID;
  readonly displayName = 'Grok';
  readonly metadata: ProviderMetadata = {
    id: GROK_PROVIDER_ID,
    displayName: this.displayName,
    description:
      'Uses the Grok CLI installed on this computer and its existing sign-in. Your request, project instructions, Brand Kit, a text summary of existing Komas, and asset names are sent to xAI.',
    kind: 'cli',
    usesExternalService: true,
    supportsModelSelection: true,
    defaultModel: null,
    modelCatalog: {
      source: 'cli',
      models: [],
      note: 'Models and reasoning choices reported by Grok. If this CLI does not report effort choices, its default reasoning is used.',
    },
    acceptsCustomModel: true,
    streamsOutput: false,
  };

  readonly #environment: CliEnvironment;

  constructor(environment: CliEnvironment = createCliEnvironment()) {
    this.#environment = environment;
  }

  detect(): Promise<ProviderDetectionResult> {
    return detectCli({
      providerId: this.id,
      displayName: this.displayName,
      executableName: EXECUTABLE_NAME,
      installationHint:
        'Install Grok from https://x.ai/cli and sign in with grok login, then check again.',
      environment: this.#environment,
    });
  }

  /** ACP exposes the same model catalog as `grok models`, including per-model metadata. */
  async listModels(signal: AbortSignal): Promise<ProviderModelListing> {
    const capabilities = await discoverModels(
      this.#environment,
      'grok',
      ['agent', '--no-leader', 'stdio'],
      signal,
    );
    if (capabilities.status !== 'unsupported' || signal.aborted) return capabilities;
    // Older CLIs can still expose IDs through the documented command, without effort metadata.
    const executable = await this.#environment.resolveExecutable(EXECUTABLE_NAME);
    if (executable === null) return { status: 'failed', message: 'Grok is not installed.' };
    const workingDirectory = await this.#environment.createWorkingDirectory();
    try {
      const outcome = await this.#environment.runProcess({
        executable,
        arguments: ['models'],
        input: '',
        workingDirectory,
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        maxOutputBytes: 64 * 1024,
        env: this.#environment.childEnvironment(),
      });
      if (
        !outcome.aborted &&
        !outcome.outputLimitExceeded &&
        outcome.startError === null &&
        /unexpected argument|unknown option|unrecognized subcommand/i.test(outcome.standardError)
      )
        return { status: 'unsupported' };
      const parsed =
        outcome.exitCode === 0 &&
        !outcome.aborted &&
        !outcome.outputLimitExceeded &&
        outcome.startError === null
          ? parseGrokModelList(outcome.standardOutput)
          : null;
      if (parsed === null)
        return {
          status: 'failed',
          message: 'Grok could not list models. Retry or use the CLI default.',
        };
      return {
        status: 'listed',
        models: parsed.models.map((id) => ({
          id,
          label: id,
          reasoning: { status: 'unsupported' },
        })),
        defaultModel: parsed.defaultModel,
        checkedAt: this.#environment.now().toISOString(),
      };
    } finally {
      await this.#environment.removeWorkingDirectory(workingDirectory).catch(() => undefined);
    }
  }

  generatePresentation(
    _request: PresentationGenerationRequest,
    context: AgentExecutionContext,
  ): Promise<ProviderExecutionResult> {
    return this.#run(
      context,
      context.attempt === 1
        ? 'Grok is designing the Komas. This can take a few minutes'
        : 'Grok is correcting its response',
    );
  }

  /** The CLI only sees the rendered prompt, so a transition runs like a presentation. */
  generateTransition(
    _request: TransitionRegenerationRequest,
    context: AgentExecutionContext,
  ): Promise<ProviderExecutionResult> {
    return this.#run(
      context,
      context.attempt === 1
        ? 'Grok is choosing the motion of one transition'
        : 'Grok is correcting its response',
    );
  }

  async #run(context: AgentExecutionContext, progress: string): Promise<ProviderExecutionResult> {
    const executable = await this.#environment.resolveExecutable(EXECUTABLE_NAME);
    if (executable === null) {
      return {
        ok: false,
        error: agentError('providerUnavailable', `${this.displayName} is not installed.`),
        details: { exitCode: null, errorOutput: '' },
      };
    }

    const reasoning = await validatedReasoning(context, (signal) => this.listModels(signal));
    const workingDirectory = await this.#environment.createWorkingDirectory();
    try {
      const promptFile = join(workingDirectory, PROMPT_FILE_NAME);
      await writeFile(promptFile, context.prompt.user, 'utf8');
      context.reportProgress(progress);
      const outcome = await this.#environment.runProcess({
        executable,
        arguments: buildGrokArguments({
          promptFile,
          workingDirectory,
          systemPrompt: context.prompt.system,
          responseJsonSchema: JSON.stringify(context.prompt.responseJsonSchema),
          model: context.model,
          reasoning,
        }),
        input: '',
        workingDirectory,
        signal: context.signal,
        maxOutputBytes: MAX_CLI_OUTPUT_BYTES,
        env: this.#environment.childEnvironment(),
      });
      const details = {
        exitCode: outcome.exitCode,
        errorOutput: redactDiagnostics(outcome.standardError),
      };

      if (outcome.outputLimitExceeded || outcome.aborted || outcome.startError !== null) {
        const failure = describeProcessFailure(this.displayName, outcome);
        if (failure !== null)
          return { ok: false, error: agentError(failure.code, failure.message), details };
      }
      const envelope = parseGrokEnvelope(outcome.standardOutput);
      if (envelope?.isError === true) {
        const reason = redactDiagnostics(envelope.result, 300);
        return {
          ok: false,
          error: agentError(
            'executionFailed',
            `${this.displayName} reported an error${reason === '' ? '.' : `: ${reason}`}`,
          ),
          details,
        };
      }
      const failure = describeProcessFailure(this.displayName, outcome);
      if (failure !== null) {
        return { ok: false, error: agentError(failure.code, failure.message), details };
      }
      if (envelope === null) {
        return { ok: true, output: { rawText: outcome.standardOutput }, details };
      }
      const hasStructuredOutput =
        typeof envelope.structuredOutput === 'object' &&
        envelope.structuredOutput !== null &&
        !Array.isArray(envelope.structuredOutput);
      return {
        ok: true,
        output: hasStructuredOutput
          ? { rawText: envelope.result, structured: envelope.structuredOutput }
          : { rawText: envelope.result },
        details,
      };
    } finally {
      await this.#environment.removeWorkingDirectory(workingDirectory).catch(() => undefined);
    }
  }
}
