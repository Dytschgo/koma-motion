import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
import { MAX_AGENT_OUTPUT_LENGTH } from '../validation/extract';
import {
  createCliEnvironment,
  describeProcessFailure,
  detectCli,
  MAX_CLI_OUTPUT_BYTES,
  type CliEnvironment,
} from './cliEnvironment';
import { redactDiagnostics } from './redact';

export const CODEX_PROVIDER_ID = 'codex';
const EXECUTABLE_NAME = 'codex';
const SCHEMA_FILE_NAME = 'response-schema.json';
const ANSWER_FILE_NAME = 'answer.json';

/**
 * Arguments of the non-interactive invocation, taken from the help output of
 * Codex CLI 0.157.1. Detection has been run; generation has NOT been run
 * against a real Codex installation yet. See docs/AGENT_PROVIDERS.md.
 *
 * - `exec` runs non-interactively. The final `-` reads the prompt from
 *   standard input.
 * - `--sandbox read-only` forbids commands of the agent to write or use the network.
 * - `--skip-git-repo-check` allows the empty temporary working directory.
 * - `--ephemeral` keeps the session out of the history.
 * - `--output-schema` and `--output-last-message` name files in the temporary
 *   working directory. Koma Motion creates both paths itself.
 */
export function buildCodexArguments(options: {
  readonly workingDirectory: string;
  readonly model: string | null;
}): string[] {
  const model = options.model === null ? [] : ['--model', modelNameSchema.parse(options.model)];
  return [
    'exec',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--color',
    'never',
    ...model,
    '--cd',
    options.workingDirectory,
    '--output-schema',
    join(options.workingDirectory, SCHEMA_FILE_NAME),
    '--output-last-message',
    join(options.workingDirectory, ANSWER_FILE_NAME),
    '-',
  ];
}

async function readAnswer(workingDirectory: string): Promise<string | null> {
  const path = join(workingDirectory, ANSWER_FILE_NAME);
  try {
    const details = await stat(path);
    if (!details.isFile() || details.size > MAX_AGENT_OUTPUT_LENGTH * 4) {
      return null;
    }
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/** Generates presentations with a locally installed Codex CLI. */
export class CodexCliProvider implements AgentProvider {
  readonly id = CODEX_PROVIDER_ID;
  readonly displayName = 'Codex CLI';
  readonly metadata: ProviderMetadata = {
    id: CODEX_PROVIDER_ID,
    displayName: this.displayName,
    description:
      'Uses the Codex CLI installed on this computer and its existing sign-in. Requests are sent to OpenAI. Experimental: generation with this provider has not been verified yet.',
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
      installationHint: 'Install the Codex CLI and sign in, then check again.',
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
      await writeFile(
        join(workingDirectory, SCHEMA_FILE_NAME),
        JSON.stringify(context.prompt.responseJsonSchema),
        'utf8',
      );
      context.reportProgress(
        context.attempt === 1
          ? 'Codex is designing the Komas. This can take a few minutes'
          : 'Codex is correcting its response',
      );
      const outcome = await this.#environment.runProcess({
        executable,
        arguments: buildCodexArguments({ workingDirectory, model: context.model }),
        // Codex has no separate system prompt in non-interactive mode.
        input: `${context.prompt.system}\n\n${context.prompt.user}`,
        workingDirectory,
        signal: context.signal,
        maxOutputBytes: MAX_CLI_OUTPUT_BYTES,
      });
      const details = {
        exitCode: outcome.exitCode,
        errorOutput: redactDiagnostics(outcome.standardError),
      };

      const failure = describeProcessFailure(this.displayName, outcome);
      if (failure !== null) {
        return { ok: false, error: agentError(failure.code, failure.message), details };
      }
      const answer = await readAnswer(workingDirectory);
      if (answer === null) {
        return {
          ok: false,
          error: agentError('noStructuredOutput', `${this.displayName} did not write an answer.`),
          details,
        };
      }
      return { ok: true, output: { rawText: answer }, details };
    } finally {
      await this.#environment.removeWorkingDirectory(workingDirectory).catch(() => undefined);
    }
  }
}
