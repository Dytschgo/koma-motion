import { modelNameSchema } from '@koma-motion/core';
import { agentError } from '../contract/errors';
import type { PresentationGenerationRequest } from '../contract/request';
import type { TransitionRegenerationRequest } from '../contract/transition';
import type {
  AgentExecutionContext,
  AgentProvider,
  ProviderDetectionResult,
  ProviderExecutionResult,
  ModelCatalog,
  ProviderMetadata,
} from '../providers/types';
import {
  createCliEnvironment,
  describeProcessFailure,
  detectCli,
  MAX_CLI_OUTPUT_BYTES,
  type CliEnvironment,
} from './cliEnvironment';
import { redactDiagnostics } from './redact';
import { analyzeBrandKitWithClaude } from './claudeBrandKitAnalysis';
import type {
  BrandKitAnalysisContext,
  BrandKitAnalysisRequest,
  BrandKitAnalysisResponse,
} from '../contract/brandKitAnalysis';

export const CLAUDE_CODE_PROVIDER_ID = 'claude-code';

/**
 * Models offered for Claude Code. `claude --help` documents the aliases
 * `fable`, `opus` and `sonnet` and accepts a model's full name; `haiku` was
 * accepted by Claude Code 2.1.285 on 30 September 2026. Claude Code has no
 * command that lists the models of a sign-in, so this list is curated and
 * the CLI decides at run time whether a model is available.
 */
export const CLAUDE_MODEL_CATALOG: ModelCatalog = {
  source: 'curated',
  models: [
    { id: 'fable', label: 'Fable (latest)', kind: 'alias' },
    { id: 'opus', label: 'Opus (latest)', kind: 'alias' },
    { id: 'sonnet', label: 'Sonnet (latest)', kind: 'alias' },
    { id: 'haiku', label: 'Haiku (latest)', kind: 'alias' },
    { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', kind: 'id' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', kind: 'id' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', kind: 'id' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', kind: 'id' },
  ],
  note: 'A list of Claude Code aliases and model names. Claude Code cannot list the models of your sign-in; it reports a model it cannot use when the run starts.',
};
const EXECUTABLE_NAME = 'claude';

/**
 * Arguments of the non-interactive invocation. The complete invocation was
 * exercised through Electron with Claude Code 2.1.285 on Windows on
 * 30 September 2026, using the CLI's default model and existing sign-in.
 * See docs/AGENT_PROVIDERS.md for earlier runs and platform limits.
 *
 * `--bare` is not passed. Its help text says auth is strictly
 * `ANTHROPIC_API_KEY` or `apiKeyHelper` via `--settings`, and OAuth and the
 * keychain are never read. That would drop the existing sign-in.
 *
 * - `--print` answers once and exits.
 * - `--output-format json` wraps the answer in one JSON envelope.
 * - `--tools ""` names no tools.
 * - `--strict-mcp-config` without `--mcp-config` loads no MCP servers.
 * - `--disable-slash-commands` disables skills.
 * - `--permission-prompts none` denies anything that would ask for permission.
 * - `--no-session-persistence` keeps the conversation out of the session history.
 * - `--safe-mode` disables customizations. Admin-managed settings still apply.
 * - `--restricted` removes built-in tools that run commands or code, and
 *   WebFetch, unless `--tools` names them.
 * - `--no-chrome` disables Claude in Chrome.
 */
const FIXED_ARGUMENTS = [
  '--print',
  '--output-format',
  'json',
  '--input-format',
  'text',
  '--tools',
  '',
  '--strict-mcp-config',
  '--disable-slash-commands',
  '--permission-prompts',
  'none',
  '--no-session-persistence',
  '--safe-mode',
  '--restricted',
  '--no-chrome',
] as const;

export function buildClaudeCodeArguments(options: {
  readonly systemPrompt: string;
  readonly responseJsonSchema: string;
  readonly model: string | null;
}): string[] {
  const model = options.model === null ? [] : ['--model', modelNameSchema.parse(options.model)];
  return [
    ...FIXED_ARGUMENTS,
    ...model,
    '--system-prompt',
    options.systemPrompt,
    '--json-schema',
    options.responseJsonSchema,
  ];
}

interface ClaudeEnvelope {
  readonly isError: boolean;
  readonly result: string;
  readonly structuredOutput: unknown;
}

/** Reads the JSON envelope printed by `--output-format json`. */
export function parseClaudeEnvelope(standardOutput: string): ClaudeEnvelope | null {
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
  if (record['type'] !== 'result') {
    return null;
  }
  return {
    isError: record['is_error'] === true,
    result: typeof record['result'] === 'string' ? record['result'] : '',
    structuredOutput: record['structured_output'],
  };
}

/**
 * Whether an error result says that the chosen model cannot be used. Claude
 * Code words this in several ways ("model not found", "may not exist or you
 * may not have access", "invalid model"); all name the model.
 */
export function describesUnavailableModel(result: string): boolean {
  return (
    /\bmodel\b/i.test(result) &&
    /(not[ _]found|not exist|does not exist|not have access|no access|invalid model|unknown model|not available)/i.test(
      result,
    )
  );
}

/** Generates presentations with a locally installed Claude Code CLI. */
export class ClaudeCodeProvider implements AgentProvider {
  readonly id = CLAUDE_CODE_PROVIDER_ID;
  readonly displayName = 'Claude Code';
  readonly metadata: ProviderMetadata = {
    id: CLAUDE_CODE_PROVIDER_ID,
    displayName: this.displayName,
    description:
      'Uses the Claude Code CLI installed on this computer and its existing sign-in. Requests are sent to Anthropic.',
    kind: 'cli',
    usesExternalService: true,
    supportsModelSelection: true,
    defaultModel: null,
    modelCatalog: CLAUDE_MODEL_CATALOG,
    acceptsCustomModel: true,
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
      installationHint: 'Install Claude Code and sign in, then check again.',
      environment: this.#environment,
    });
  }

  analyzeBrandKit(
    request: BrandKitAnalysisRequest,
    context: BrandKitAnalysisContext,
  ): Promise<BrandKitAnalysisResponse> {
    return analyzeBrandKitWithClaude(this.#environment, request, context);
  }

  generatePresentation(
    _request: PresentationGenerationRequest,
    context: AgentExecutionContext,
  ): Promise<ProviderExecutionResult> {
    return this.#run(
      context,
      context.attempt === 1
        ? 'Claude Code is designing the Komas. This can take a few minutes'
        : 'Claude Code is correcting its response',
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
        ? 'Claude Code is choosing the motion of one transition'
        : 'Claude Code is correcting its response',
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

    const workingDirectory = await this.#environment.createWorkingDirectory();
    try {
      context.reportProgress(progress);
      const outcome = await this.#environment.runProcess({
        executable,
        arguments: buildClaudeCodeArguments({
          systemPrompt: context.prompt.system,
          responseJsonSchema: JSON.stringify(context.prompt.responseJsonSchema),
          model: context.model,
        }),
        input: context.prompt.user,
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
      const envelope = parseClaudeEnvelope(outcome.standardOutput);
      if (envelope?.isError === true) {
        if (context.model !== null && describesUnavailableModel(envelope.result)) {
          return {
            ok: false,
            error: agentError(
              'executionFailed',
              `The model "${context.model}" is not available to your Claude Code sign-in. Choose another model or use the default.`,
            ),
            details,
          };
        }
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
        // Not the expected envelope: hand the text to validation as it is.
        return { ok: true, output: { rawText: outcome.standardOutput }, details };
      }
      const hasStructuredOutput =
        typeof envelope.structuredOutput === 'object' && envelope.structuredOutput !== null;
      return {
        ok: true,
        output: hasStructuredOutput
          ? {
              // The text is kept as Claude wrote it, so the runtime can see
              // when it disagrees with the structured output.
              rawText: envelope.result,
              structured: envelope.structuredOutput,
            }
          : { rawText: envelope.result },
        details,
      };
    } finally {
      await this.#environment.removeWorkingDirectory(workingDirectory).catch(() => undefined);
    }
  }
}
