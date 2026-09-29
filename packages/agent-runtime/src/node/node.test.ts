import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getResponseJsonSchema } from '../contract/response';
import { presentationGenerationPromptV1 } from '../prompts/presentationGeneration';
import type { AgentExecutionContext } from '../providers/types';
import { buildRequest, buildResponse } from '../testing/fixtures';
import {
  buildClaudeCodeArguments,
  ClaudeCodeProvider,
  parseClaudeEnvelope,
} from './ClaudeCodeProvider';
import { detectCli, type CliEnvironment } from './cliEnvironment';
import { buildCodexArguments, CodexCliProvider } from './CodexCliProvider';
import { redactDiagnostics } from './redact';
import { resolveExecutable, type ResolutionEnvironment } from './resolveExecutable';
import {
  assertSafeArguments,
  runProcess,
  type ProcessResult,
  type ProcessSpecification,
} from './runProcess';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'koma-agent-test-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true, maxRetries: 3 });
});

const node = { command: process.execPath, prefixArguments: [] };

function run(script: string, options: Partial<ProcessSpecification> = {}): Promise<ProcessResult> {
  return runProcess({
    executable: node,
    arguments: ['-e', script],
    input: '',
    workingDirectory: directory,
    signal: new AbortController().signal,
    maxOutputBytes: 1024 * 1024,
    ...options,
  });
}

function completed(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    exitCode: 0,
    standardOutput: '',
    standardError: '',
    outputLimitExceeded: false,
    aborted: false,
    startError: null,
    ...overrides,
  };
}

function fakeEnvironment(
  outcome: ProcessResult | ((specification: ProcessSpecification) => Promise<ProcessResult>),
  installed = true,
): CliEnvironment & { readonly calls: ProcessSpecification[] } {
  const calls: ProcessSpecification[] = [];
  return {
    calls,
    resolveExecutable: () =>
      Promise.resolve(installed ? { command: '/opt/tool', prefixArguments: [] } : null),
    runProcess: (specification) => {
      calls.push(specification);
      return typeof outcome === 'function' ? outcome(specification) : Promise.resolve(outcome);
    },
    createWorkingDirectory: () => mkdtemp(join(directory, 'work-')),
    removeWorkingDirectory: (path) => rm(path, { recursive: true, force: true }),
    now: () => new Date('2026-01-15T10:30:00.000Z'),
  };
}

function context(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return {
    executionId: 'execution-1',
    attempt: 1,
    prompt: presentationGenerationPromptV1.render({
      request: buildRequest(),
      responseJsonSchema: getResponseJsonSchema(),
    }),
    model: null,
    signal: new AbortController().signal,
    reportProgress: () => undefined,
    ...overrides,
  };
}

describe('runProcess', () => {
  it('passes input and arguments without a shell', async () => {
    const result = await run(
      'process.stdin.on("data", (d) => process.stdout.write(process.argv[1] + ":" + d))',
      {
        arguments: [
          '-e',
          'process.stdin.on("data", (d) => process.stdout.write(process.argv[1] + ":" + d))',
          '$(echo injected) && "quoted" ; `x` | %PATH%',
        ],
        input: 'prompt text',
      },
    );
    expect(result).toEqual(
      completed({ standardOutput: '$(echo injected) && "quoted" ; `x` | %PATH%:prompt text' }),
    );
  });

  it('captures the exit code and error output', async () => {
    const result = await run('process.stderr.write("broken"); process.exit(3)');
    expect(result).toMatchObject({ exitCode: 3, standardError: 'broken', aborted: false });
  });

  it('stops the process when it is aborted', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = run('setInterval(() => {}, 1000)', { signal: controller.signal });
    setTimeout(() => {
      controller.abort();
    }, 200);
    const result = await pending;
    expect(result.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('does not start when the signal is already aborted', async () => {
    const result = await run('process.stdout.write("ran")', { signal: AbortSignal.abort() });
    expect(result).toMatchObject({ aborted: true, standardOutput: '' });
  });

  it('stops a process that produces too much output', async () => {
    const result = await run('setInterval(() => process.stdout.write("x".repeat(65536)), 1)', {
      maxOutputBytes: 200_000,
    });
    expect(result.outputLimitExceeded).toBe(true);
    expect(result.standardOutput.length).toBeLessThanOrEqual(200_000);
  });

  it('reports a program that cannot be started', async () => {
    const result = await runProcess({
      executable: { command: join(directory, 'missing-program'), prefixArguments: [] },
      arguments: [],
      input: '',
      workingDirectory: directory,
      signal: new AbortController().signal,
      maxOutputBytes: 1024,
    });
    expect(result.startError).toBe('ENOENT');
    expect(result.exitCode).toBeNull();
  });
});

describe('assertSafeArguments', () => {
  it('accepts ordinary arguments including empty ones', () => {
    expect(() => {
      assertSafeArguments(['--tools', '', '--model', 'claude-opus-5-5']);
    }).not.toThrow();
  });

  it('rejects NUL characters and oversized arguments', () => {
    expect(() => {
      assertSafeArguments(['a\u0000b']);
    }).toThrow(RangeError);
    expect(() => {
      assertSafeArguments(['x'.repeat(30_000)]);
    }).toThrow(RangeError);
  });
});

describe('resolveExecutable', () => {
  const environment = (platform: NodeJS.Platform, ...paths: string[]): ResolutionEnvironment => ({
    platform,
    env: { PATH: paths.join(platform === 'win32' ? ';' : ':') },
    homeDirectory: join(directory, 'home'),
  });

  it('returns null for a program that is not installed', async () => {
    expect(await resolveExecutable('koma-missing', environment(process.platform, directory))).toBe(
      null,
    );
  });

  it.each(['../evil', 'a b', 'tool;rm', '', 'C:\\tool'])('rejects the name "%s"', async (name) => {
    expect(await resolveExecutable(name, environment(process.platform, directory))).toBeNull();
  });

  it.runIf(process.platform === 'win32')('finds an .exe on Windows', async () => {
    await writeFile(join(directory, 'tool.exe'), '');
    expect(await resolveExecutable('tool', environment('win32', directory))).toEqual({
      command: join(directory, 'tool.exe'),
      prefixArguments: [],
    });
  });

  it.runIf(process.platform === 'win32')(
    'starts the script of an npm shim with Node.js instead of a shell',
    async () => {
      const bin = join(directory, 'npm');
      const nodeDirectory = join(directory, 'nodejs');
      await mkdir(join(bin, 'node_modules', '@scope', 'tool', 'bin'), { recursive: true });
      await mkdir(nodeDirectory);
      await writeFile(join(bin, 'node_modules', '@scope', 'tool', 'bin', 'tool.js'), '');
      await writeFile(join(nodeDirectory, 'node.exe'), '');
      await writeFile(
        join(bin, 'tool.cmd'),
        '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@scope\\tool\\bin\\tool.js" %*\r\n',
      );

      expect(await resolveExecutable('tool', environment('win32', bin, nodeDirectory))).toEqual({
        command: join(nodeDirectory, 'node.exe'),
        prefixArguments: [join(bin, 'node_modules', '@scope', 'tool', 'bin', 'tool.js')],
      });
    },
  );

  it.runIf(process.platform === 'win32')(
    'ignores a shim that points outside its node_modules folder',
    async () => {
      await writeFile(join(directory, 'node.exe'), '');
      await writeFile(join(directory, 'outside.js'), '');
      await writeFile(
        join(directory, 'tool.cmd'),
        '"%_prog%"  "%dp0%\\node_modules\\..\\outside.js" %*\r\n',
      );
      expect(await resolveExecutable('tool', environment('win32', directory))).toBeNull();
    },
  );

  it.runIf(process.platform !== 'win32')('finds an executable file on the PATH', async () => {
    const path = join(directory, 'tool');
    await writeFile(path, '#!/bin/sh\n', { mode: 0o755 });
    expect(await resolveExecutable('tool', environment(process.platform, directory))).toEqual({
      command: path,
      prefixArguments: [],
    });
  });
});

describe('detectCli', () => {
  const detect = (environment: CliEnvironment): ReturnType<typeof detectCli> =>
    detectCli({
      providerId: 'claude-code',
      displayName: 'Claude Code',
      executableName: 'claude',
      installationHint: 'Install it.',
      environment,
    });

  it('reports the installed version', async () => {
    const environment = fakeEnvironment(completed({ standardOutput: '2.1.283 (Claude Code)\n' }));
    expect(await detect(environment)).toEqual({
      providerId: 'claude-code',
      availability: 'available',
      version: '2.1.283',
      message: 'Version 2.1.283 is installed.',
      checkedAt: '2026-01-15T10:30:00.000Z',
    });
    expect(environment.calls[0]?.arguments).toEqual(['--version']);
  });

  it('reports a CLI that is not installed', async () => {
    const result = await detect(fakeEnvironment(completed(), false));
    expect(result).toMatchObject({ availability: 'unavailable', version: null });
    expect(result.message).toContain('not installed');
  });

  it.each([
    ['an error exit code', completed({ exitCode: 2 })],
    ['a start failure', completed({ exitCode: null, startError: 'EACCES' })],
    ['a timeout', completed({ exitCode: null, aborted: true })],
  ])('reports %s as an error', async (_label, outcome) => {
    expect((await detect(fakeEnvironment(outcome))).availability).toBe('error');
  });

  it('accepts a version it cannot read', async () => {
    const result = await detect(fakeEnvironment(completed({ standardOutput: 'development' })));
    expect(result).toMatchObject({ availability: 'available', version: null });
  });
});

describe('ClaudeCodeProvider', () => {
  const envelope = (fields: Record<string, unknown>): string =>
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', ...fields });

  it('builds arguments that disable tools and never contain the prompt', () => {
    const args = buildClaudeCodeArguments({
      systemPrompt: 'system',
      responseJsonSchema: '{}',
      model: 'claude-opus-5-5',
    });
    expect(args.slice(0, 2)).toEqual(['--print', '--output-format']);
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-5-5');
    expect(args[args.indexOf('--permission-prompts') + 1]).toBe('none');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it.each(['opus; rm -rf /', '--dangerously-skip-permissions', 'a b', ''])(
    'rejects the model name "%s"',
    (model) => {
      expect(() =>
        buildClaudeCodeArguments({ systemPrompt: '', responseJsonSchema: '{}', model }),
      ).toThrow();
    },
  );

  it('sends the prompt on standard input and returns structured output', async () => {
    const structured = buildResponse();
    const environment = fakeEnvironment(
      completed({ standardOutput: envelope({ structured_output: structured, result: 'text' }) }),
    );
    const provider = new ClaudeCodeProvider(environment);

    const result = await provider.generatePresentation(buildRequest(), context());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.structured).toEqual(structured);
    }
    const call = environment.calls[0];
    expect(call?.input).toContain('# Request');
    expect(call?.arguments.join(' ')).not.toContain('# Request');
  });

  it('falls back to the text result', async () => {
    const provider = new ClaudeCodeProvider(
      fakeEnvironment(completed({ standardOutput: envelope({ result: '{"a":1}' }) })),
    );
    const result = await provider.generatePresentation(buildRequest(), context());
    expect(result.ok && result.output).toEqual({ rawText: '{"a":1}' });
  });

  it('reports errors of the CLI and redacts them', async () => {
    const provider = new ClaudeCodeProvider(
      fakeEnvironment(
        completed({
          exitCode: 1,
          standardOutput: envelope({
            is_error: true,
            result: 'Invalid API key sk-ant-abcdefghijklmnopqrstuvwxyz',
          }),
        }),
      ),
    );
    const result = await provider.generatePresentation(buildRequest(), context());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('executionFailed');
      expect(result.error.message).toContain('Invalid API key');
      expect(result.error.message).not.toContain('abcdefghijklmnop');
    }
  });

  it('reports a failing exit code', async () => {
    const provider = new ClaudeCodeProvider(
      fakeEnvironment(completed({ exitCode: 1, standardError: 'boom' })),
    );
    const result = await provider.generatePresentation(buildRequest(), context());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Claude Code ended with exit code 1. It reported: boom');
      expect(result.details).toEqual({ exitCode: 1, errorOutput: 'boom' });
    }
  });

  it('reports a missing installation', async () => {
    const provider = new ClaudeCodeProvider(fakeEnvironment(completed(), false));
    const result = await provider.generatePresentation(buildRequest(), context());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('providerUnavailable');
    }
  });

  it('parses only result envelopes', () => {
    expect(parseClaudeEnvelope('not json')).toBeNull();
    expect(parseClaudeEnvelope('{"type":"other"}')).toBeNull();
    expect(parseClaudeEnvelope(envelope({ result: 'x' }))).toEqual({
      isError: false,
      result: 'x',
      structuredOutput: undefined,
    });
  });
});

describe('CodexCliProvider', () => {
  it('builds arguments for a read-only non-interactive run', () => {
    const args = buildCodexArguments({ workingDirectory: directory, model: null });
    expect(args[0]).toBe('exec');
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(args.at(-1)).toBe('-');
    expect(args).not.toContain('--model');
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args[args.indexOf('--output-last-message') + 1]).toBe(join(directory, 'answer.json'));
  });

  it('reads the answer file that the CLI writes', async () => {
    const answer = JSON.stringify(buildResponse());
    const environment = fakeEnvironment(async (specification) => {
      const target =
        specification.arguments[specification.arguments.indexOf('--output-last-message') + 1];
      await writeFile(target ?? '', answer, 'utf8');
      return completed();
    });
    const provider = new CodexCliProvider(environment);

    const result = await provider.generatePresentation(buildRequest(), context());

    expect(result.ok && result.output.rawText).toBe(answer);
    expect(environment.calls[0]?.input).toContain('You are the presentation designer');
    expect(environment.calls[0]?.input).toContain('# Request');
  });

  it('reports a run without an answer', async () => {
    const provider = new CodexCliProvider(fakeEnvironment(completed()));
    const result = await provider.generatePresentation(buildRequest(), context());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('noStructuredOutput');
    }
  });
});

describe('redactDiagnostics', () => {
  it.each([
    ['an API key', 'key sk-ant-REDACTME0123456789abcdef used', 'REDACTME'],
    ['a GitHub token', 'ghp_REDACTME0123456789abcdefghijkl', 'REDACTME'],
    ['a bearer token', 'Authorization: Bearer REDACTME.0123456789', 'REDACTME'],
    ['an assignment', 'ANTHROPIC_API_KEY=REDACTME123', 'REDACTME'],
    ['a JSON property', '{"access_token": "REDACTME123"}', 'REDACTME'],
  ])('removes %s', (_label, text, secret) => {
    const redacted = redactDiagnostics(text);
    expect(redacted).not.toContain(secret);
    expect(redacted).toContain('[redacted]');
  });

  it('keeps ordinary messages', () => {
    expect(redactDiagnostics('Error: rate limit reached, try again later')).toBe(
      'Error: rate limit reached, try again later',
    );
  });

  it('removes control characters and limits the length', () => {
    expect(redactDiagnostics('\u001b[31mred\u001b[0m\u0007 text')).toBe('red text');
    const long = redactDiagnostics('x'.repeat(5000), 100);
    expect(long).toBe(`${'x'.repeat(100)}\n[truncated]`);
  });
});
