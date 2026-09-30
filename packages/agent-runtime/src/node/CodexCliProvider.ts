import { open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, modelNameSchema, type Result } from '@koma-motion/core';
import { agentError, type AgentError } from '../contract/errors';
import type { PresentationGenerationRequest } from '../contract/request';
import type {
  AgentExecutionContext,
  AgentProvider,
  ProviderDetectionResult,
  ProviderExecutionResult,
  ProviderMetadata,
} from '../providers/types';
import { MAX_AGENT_OUTPUT_BYTES, AGENT_OUTPUT_TOO_LARGE_MESSAGE } from '../validation/extract';
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
 * Features that `codex features list` showed as stable and enabled on Codex
 * CLI 0.157.1 and that grant extra capability. `--disable` is an invocation
 * override; it does not write config.toml. Generation with these flags was
 * not run.
 */
const DISABLED_CODEX_FEATURES = [
  'hooks',
  'plugins',
  'plugin_sharing',
  'remote_plugin',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'computer_use',
  'shell_tool',
] as const;

/**
 * Arguments of the non-interactive invocation, taken from `codex exec --help`
 * and `codex features list` of Codex CLI 0.157.1 on Windows on 29 September
 * 2026. Detection has been run; generation has NOT been run. See
 * docs/AGENT_PROVIDERS.md.
 *
 * - `exec` runs non-interactively. The final `-` reads the prompt from
 *   standard input.
 * - `--sandbox read-only` still allows filesystem reads. No verified flag
 *   means no filesystem access.
 * - `--skip-git-repo-check` allows the empty temporary working directory.
 * - `--ephemeral` keeps the session out of the history.
 * - `--ignore-user-config` skips `$CODEX_HOME/config.toml`. Auth still uses
 *   `CODEX_HOME`, which is not repointed.
 * - `--ignore-rules` skips user and project execpolicy rules.
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
    '--ignore-user-config',
    '--ignore-rules',
    ...DISABLED_CODEX_FEATURES.flatMap((feature) => ['--disable', feature]),
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

/** Read at most the response budget plus one byte, even if the file grows after stat. */
async function readAnswer(workingDirectory: string): Promise<Result<string, AgentError>> {
  const path = join(workingDirectory, ANSWER_FILE_NAME);
  const tooLarge = () => err(agentError('outputTooLarge', AGENT_OUTPUT_TOO_LARGE_MESSAGE));
  try {
    const handle = await open(path, 'r');
    try {
      const details = await handle.stat();
      if (!details.isFile()) throw new Error('Not a file');
      if (details.size > MAX_AGENT_OUTPUT_BYTES) return tooLarge();
      const chunks: Buffer[] = [];
      let received = 0;
      while (received <= MAX_AGENT_OUTPUT_BYTES) {
        const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_AGENT_OUTPUT_BYTES + 1 - received));
        const { bytesRead } = await handle.read(chunk);
        if (bytesRead === 0) return ok(Buffer.concat(chunks, received).toString('utf8'));
        received += bytesRead;
        if (received > MAX_AGENT_OUTPUT_BYTES) return tooLarge();
        chunks.push(chunk.subarray(0, bytesRead));
      }
      return tooLarge();
    } finally {
      await handle.close();
    }
  } catch {
    return err(
      agentError(
        'noStructuredOutput',
        'Codex CLI did not write a readable answer. Retry the generation.',
      ),
    );
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
        env: this.#environment.childEnvironment(),
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
      if (!answer.ok) return { ok: false, error: answer.error, details };
      return { ok: true, output: { rawText: answer.value }, details };
    } finally {
      await this.#environment.removeWorkingDirectory(workingDirectory).catch(() => undefined);
    }
  }
}
