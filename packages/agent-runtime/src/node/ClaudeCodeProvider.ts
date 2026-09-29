import { modelNameSchema } from '@koma-motion/core';
import { agentError } from '../contract/errors';
import type { PresentationGenerationRequest } from '../contract/request';
import type {
  AgentExecutionContext,
  AgentProvider,
  ProviderDetectionResult,
  ProviderExecutionResult,
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

export const CLAUDE_CODE_PROVIDER_ID = 'claude-code';
const EXECUTABLE_NAME = 'claude';

/**
 * Arguments of the non-interactive invocation. Verified against the help
 * output and a real run of Claude Code 2.1.283; see docs/AGENT_PROVIDERS.md.
 *
 * - `--print` answers once and exits.
 * - `--output-format json` wraps the answer in one JSON envelope.
 * - `--tools ""` removes every tool: the agent cannot read files, run
 *   commands or use the network on behalf of the request.
 * - `--strict-mcp-config` without `--mcp-config` loads no MCP servers.
 * - `--disable-slash-commands` disables skills.
 * - `--permission-prompts none` denies anything that would ask for permission.
 * - `--no-session-persistence` keeps the conversation out of the session history.
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

  async generatePresentation(
    _request: PresentationGenerationRequest,
    context: AgentExecutionContext,
  ): Promise<ProviderExecutionResult> {
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
      context.reportProgress(
        context.attempt === 1
          ? 'Claude Code is designing the Komas. This can take a few minutes'
          : 'Claude Code is correcting its response',
      );
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
      });
      const details = {
        exitCode: outcome.exitCode,
        errorOutput: redactDiagnostics(outcome.standardError),
      };

      const envelope = parseClaudeEnvelope(outcome.standardOutput);
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
        // Not the expected envelope: hand the text to validation as it is.
        return { ok: true, output: { rawText: outcome.standardOutput }, details };
      }
      const hasStructuredOutput =
        typeof envelope.structuredOutput === 'object' && envelope.structuredOutput !== null;
      return {
        ok: true,
        output: hasStructuredOutput
          ? {
              // The runtime size-checks structured output before preferring the envelope.
              rawText: JSON.stringify(envelope.structuredOutput),
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
