import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderDetectionResult } from '../providers/types';
import { redactDiagnostics } from './redact';
import { resolveExecutable, type ResolvedExecutable } from './resolveExecutable';
import { runProcess, type ProcessResult, type ProcessSpecification } from './runProcess';

/**
 * Names copied into a CLI child, and only when the parent has a string value.
 * Anything else in the application environment stays there. On Windows, Node
 * passes the first case-insensitive spelling, and the platform still adds
 * `LOGONSERVER`, which this list cannot remove.
 */
export const CLI_CHILD_ENVIRONMENT_ALLOWLIST = [
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'SystemDrive',
  'PATH',
  'Path',
  'PATHEXT',
  'COMSPEC',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'HOME',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'USERNAME',
  'USERDOMAIN',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ssl_cert_file',
  'ssl_cert_dir',
  'node_extra_ca_certs',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'CODEX_HOME',
] as const;

/** Builds the environment passed to a CLI. The result is not merged with the parent. */
export function buildCliChildEnvironment(
  parent: Readonly<NodeJS.ProcessEnv>,
): Record<string, string> {
  const child: Record<string, string> = {};
  for (const name of CLI_CHILD_ENVIRONMENT_ALLOWLIST) {
    const value = parent[name];
    if (typeof value === 'string') {
      child[name] = value;
    }
  }
  return child;
}

/** Everything a CLI provider needs from the operating system. Replaceable in tests. */
export interface CliEnvironment {
  resolveExecutable(name: string): Promise<ResolvedExecutable | null>;
  runProcess(specification: ProcessSpecification): Promise<ProcessResult>;
  /** Allowlisted environment for a CLI child. */
  childEnvironment(): Readonly<Record<string, string>>;
  /** Creates an empty folder that only this execution uses. */
  createWorkingDirectory(): Promise<string>;
  removeWorkingDirectory(path: string): Promise<void>;
  now(): Date;
}

export function createCliEnvironment(): CliEnvironment {
  return {
    resolveExecutable: (name) => resolveExecutable(name),
    runProcess,
    childEnvironment: () => buildCliChildEnvironment(process.env),
    createWorkingDirectory: () => mkdtemp(join(tmpdir(), 'koma-motion-agent-')),
    removeWorkingDirectory: async (path) => {
      await rm(path, { recursive: true, force: true, maxRetries: 3 });
    },
    now: () => new Date(),
  };
}

/** Combined limit for the output of an agent CLI, in bytes. */
export const MAX_CLI_OUTPUT_BYTES = 8 * 1024 * 1024;
const DETECTION_TIMEOUT_MS = 15_000;
const MAX_VERSION_OUTPUT_BYTES = 64 * 1024;

/** Runs `<program> --version` to find out whether a CLI is installed and which version it has. */
export async function detectCli(options: {
  readonly providerId: string;
  readonly displayName: string;
  readonly executableName: string;
  readonly installationHint: string;
  readonly environment: CliEnvironment;
}): Promise<ProviderDetectionResult> {
  const { providerId, displayName, executableName, environment } = options;
  const result = (
    availability: ProviderDetectionResult['availability'],
    version: string | null,
    message: string,
  ): ProviderDetectionResult => ({
    providerId,
    availability,
    version,
    message,
    checkedAt: environment.now().toISOString(),
  });

  const executable = await environment.resolveExecutable(executableName);
  if (executable === null) {
    return result(
      'unavailable',
      null,
      `${displayName} is not installed or not on the PATH. ${options.installationHint}`,
    );
  }

  const workingDirectory = await environment.createWorkingDirectory();
  try {
    const outcome = await environment.runProcess({
      executable,
      arguments: ['--version'],
      input: '',
      workingDirectory,
      signal: AbortSignal.timeout(DETECTION_TIMEOUT_MS),
      maxOutputBytes: MAX_VERSION_OUTPUT_BYTES,
      env: environment.childEnvironment(),
    });
    if (outcome.startError !== null) {
      return result('error', null, `${displayName} was found but could not be started.`);
    }
    if (outcome.aborted) {
      return result('error', null, `${displayName} did not answer in time.`);
    }
    if (outcome.exitCode !== 0) {
      return result(
        'error',
        null,
        `${displayName} reported an error when asked for its version (exit code ${String(outcome.exitCode)}).`,
      );
    }
    const version = /\d+\.\d+\.\d+[0-9A-Za-z.+-]*/.exec(outcome.standardOutput)?.[0] ?? null;
    return result(
      'available',
      version,
      version === null ? `${displayName} is installed.` : `Version ${version} is installed.`,
    );
  } finally {
    await environment.removeWorkingDirectory(workingDirectory).catch(() => undefined);
  }
}

/** Describes why a process did not deliver output, or returns `null` when it did. */
export function describeProcessFailure(
  displayName: string,
  outcome: ProcessResult,
): {
  readonly code: 'executionFailed' | 'outputTooLarge' | 'cancelled';
  readonly message: string;
} | null {
  if (outcome.startError !== null) {
    return {
      code: 'executionFailed',
      message: `${displayName} could not be started (${outcome.startError}).`,
    };
  }
  if (outcome.outputLimitExceeded) {
    return {
      code: 'outputTooLarge',
      message: `${displayName} produced more output than Koma Motion accepts and was stopped.`,
    };
  }
  if (outcome.aborted) {
    return { code: 'cancelled', message: 'The generation was stopped.' };
  }
  if (outcome.exitCode !== 0) {
    const excerpt = redactDiagnostics(outcome.standardError, 300);
    return {
      code: 'executionFailed',
      message: `${displayName} ended with exit code ${String(outcome.exitCode)}.${excerpt === '' ? '' : ` It reported: ${excerpt}`}`,
    };
  }
  return null;
}
