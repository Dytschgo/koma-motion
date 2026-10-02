import { readFileSync } from 'node:fs';
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
  'XAI_API_KEY',
  'GROK_HOME',
] as const;

const VERTEX_ENVIRONMENT_NAMES = [
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'ANTHROPIC_VERTEX_BASE_URL',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'CLOUD_ML_REGION',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'ANTHROPIC_CUSTOM_HEADERS',
] as const;

type VertexEnvironmentName = (typeof VERTEX_ENVIRONMENT_NAMES)[number];

function isValidVertexValue(name: VertexEnvironmentName, value: string): boolean {
  if (name === 'CLAUDE_CODE_USE_VERTEX') return value === '1';
  if (name === 'CLAUDE_CODE_SKIP_VERTEX_AUTH') return value === '1';
  if (name === 'ANTHROPIC_VERTEX_BASE_URL') {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'https:' || url.protocol === 'http:') &&
        url.username === '' &&
        url.password === '' &&
        url.hash === ''
      );
    } catch {
      return false;
    }
  }
  if (name === 'ANTHROPIC_CUSTOM_HEADERS') {
    return value.length <= 16 * 1024 && !value.includes('\u0000');
  }
  if (name === 'ANTHROPIC_VERTEX_PROJECT_ID') {
    return /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(value);
  }
  if (name === 'CLOUD_ML_REGION') return /^(global|[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(value);
  return (
    value.length > 0 && !value.includes('\u0000') && !value.includes('\r') && !value.includes('\n')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function vertexSettingsEnvironment(
  home: string | undefined,
  configDirectory: string | undefined,
): Partial<Record<VertexEnvironmentName, string>> {
  if (
    (configDirectory === undefined || configDirectory === '') &&
    (home === undefined || home === '')
  ) {
    return {};
  }
  try {
    const settingsPath =
      configDirectory === undefined || configDirectory === ''
        ? join(home ?? '', '.claude', 'settings.json')
        : join(configDirectory, 'settings.json');
    const text = readFileSync(settingsPath, 'utf8');
    if (text.length > 256 * 1024) return {};
    const document: unknown = JSON.parse(text);
    if (!isRecord(document)) return {};
    const settings = document;
    const env = settings['env'];
    if (!isRecord(env)) return {};
    const values = env;
    const selected: Partial<Record<VertexEnvironmentName, string>> = {};
    for (const name of VERTEX_ENVIRONMENT_NAMES) {
      const value = values[name];
      if (typeof value === 'string' && isValidVertexValue(name, value)) selected[name] = value;
    }
    return selected;
  } catch {
    return {};
  }
}

/** Builds the environment passed to a CLI. The result is not merged with the parent. */
export function buildCliChildEnvironment(
  parent: Readonly<NodeJS.ProcessEnv>,
  options: { readonly claudeHome?: string } = {},
): Record<string, string> {
  const child: Record<string, string> = {};
  for (const name of CLI_CHILD_ENVIRONMENT_ALLOWLIST) {
    const value = parent[name];
    if (typeof value === 'string') {
      child[name] = value;
    }
  }
  const home = options.claudeHome ?? parent['HOME'] ?? parent['USERPROFILE'];
  const configuredVertex = vertexSettingsEnvironment(home, parent['CLAUDE_CONFIG_DIR']);
  for (const name of VERTEX_ENVIRONMENT_NAMES) {
    const value = parent[name] ?? configuredVertex[name];
    if (typeof value === 'string' && isValidVertexValue(name, value)) child[name] = value;
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
export const MAX_CLI_OUTPUT_BYTES = 32 * 1024 * 1024;
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
      message: `${displayName} exceeded the 32 MiB process-output memory safety boundary and was stopped. No partial presentation was applied. Reduce output detail or generate sections in separate projects, then retry.`,
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
