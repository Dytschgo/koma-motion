import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getResponseJsonSchema } from '../contract/response';
import { presentationGenerationPromptV2 } from '../prompts/presentationGeneration';
import type { AgentExecutionContext } from '../providers/types';
import { buildRequest, buildResponse } from '../testing/fixtures';
import {
  buildClaudeCodeArguments,
  ClaudeCodeProvider,
  parseClaudeEnvelope,
} from './ClaudeCodeProvider';
import {
  buildCliChildEnvironment,
  CLI_CHILD_ENVIRONMENT_ALLOWLIST,
  detectCli,
  type CliEnvironment,
} from './cliEnvironment';
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

function readJsonObject(text: string): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object');
  }
  const record: Readonly<Record<string, unknown>> = { ...parsed };
  return record;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error('Expected a string array');
  }
  const names: string[] = [];
  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== 'string') {
      throw new Error('Expected a string array');
    }
    names.push(entry);
  }
  return names;
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

const CHILD_ENVIRONMENT = { PATH: 'C:\\synthetic\\bin' };

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
    childEnvironment: () => CHILD_ENVIRONMENT,
    createWorkingDirectory: () => mkdtemp(join(directory, 'work-')),
    removeWorkingDirectory: (path) => rm(path, { recursive: true, force: true }),
    now: () => new Date('2026-01-15T10:30:00.000Z'),
  };
}

function context(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return {
    executionId: 'execution-1',
    attempt: 1,
    prompt: presentationGenerationPromptV2.render({
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

  it('inherits the parent environment only when env is omitted', async () => {
    const key = 'KOMA_INHERIT_SENTINEL';
    const previous = process.env[key];
    process.env[key] = 'synthetic-inherit';
    const script =
      'process.stdout.write(JSON.stringify({ value: process.env.KOMA_INHERIT_SENTINEL ?? null }))';
    try {
      const inherited = await run(script);
      expect(readJsonObject(inherited.standardOutput)['value']).toBe('synthetic-inherit');

      const replaced = await run(script, {
        env: {
          PATH: 'C:\\synthetic\\koma-path',
          ...(process.env['SystemRoot'] === undefined
            ? {}
            : { SystemRoot: process.env['SystemRoot'] }),
        },
      });
      expect(readJsonObject(replaced.standardOutput)['value']).toBeNull();
      expect(replaced.exitCode).toBe(0);
    } finally {
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
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

describe('buildCliChildEnvironment', () => {
  const expectedAllowlist = [
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
  ];

  it('copies only allowlisted string values', () => {
    expect([...CLI_CHILD_ENVIRONMENT_ALLOWLIST]).toEqual(expectedAllowlist);
    expect(
      buildCliChildEnvironment({
        PATH: 'C:\\synthetic\\koma-path',
        KOMA_UNTRUSTED_SENTINEL: 'synthetic-sentinel',
        ANTHROPIC_API_KEY: 'synthetic-anthropic',
        OPENAI_API_KEY: 'synthetic-openai',
        CODEX_HOME: 'C:\\synthetic\\codex-home',
        AWS_SECRET_ACCESS_KEY: 'synthetic-aws',
        GITHUB_TOKEN: 'synthetic-github-token',
        http_proxy: 'http://synthetic-proxy.example',
        PATH_EXTRA: undefined,
      }),
    ).toEqual({
      PATH: 'C:\\synthetic\\koma-path',
      ANTHROPIC_API_KEY: 'synthetic-anthropic',
      OPENAI_API_KEY: 'synthetic-openai',
      CODEX_HOME: 'C:\\synthetic\\codex-home',
      http_proxy: 'http://synthetic-proxy.example',
    });
  });

  it('passes PATH through to a child and drops a sentinel', async () => {
    const parent: NodeJS.ProcessEnv = {
      PATH: 'C:\\synthetic\\koma-path',
      Path: 'C:\\synthetic\\koma-path',
      KOMA_UNTRUSTED_SENTINEL: 'synthetic-sentinel',
      ANTHROPIC_API_KEY: 'synthetic-anthropic',
      OPENAI_API_KEY: 'synthetic-openai',
      CODEX_HOME: 'C:\\synthetic\\codex-home',
      AWS_SECRET_ACCESS_KEY: 'synthetic-aws',
      GITHUB_TOKEN: 'synthetic-github-token',
      http_proxy: 'http://synthetic-proxy.example',
      META_API_KEY: 'synthetic-meta',
    };
    for (const name of [
      'SystemRoot',
      'SYSTEMROOT',
      'windir',
      'SystemDrive',
      'PATHEXT',
      'COMSPEC',
      'TEMP',
      'TMP',
    ] as const) {
      const value = process.env[name];
      if (typeof value === 'string') {
        parent[name] = value;
      }
    }
    const script = [
      'const keys = ["PATH","Path","KOMA_UNTRUSTED_SENTINEL","ANTHROPIC_API_KEY","OPENAI_API_KEY","CODEX_HOME","AWS_SECRET_ACCESS_KEY","GITHUB_TOKEN","http_proxy","META_API_KEY"];',
      'const selected = {};',
      'for (const key of keys) selected[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : null;',
      'process.stdout.write(JSON.stringify({ selected, names: Object.keys(process.env).sort() }));',
    ].join('');
    const result = await run(script, { env: buildCliChildEnvironment(parent) });
    expect(result.exitCode).toBe(0);
    const printed = readJsonObject(result.standardOutput);
    const selected = printed['selected'];
    if (typeof selected !== 'object' || selected === null || Array.isArray(selected)) {
      throw new Error('Fixture output is missing selected keys');
    }
    const values: Readonly<Record<string, unknown>> = { ...selected };
    const keyNames = readStringArray(printed['names']);
    expect(values['PATH']).toBe('C:\\synthetic\\koma-path');
    expect(values['KOMA_UNTRUSTED_SENTINEL']).toBeNull();
    expect(values['ANTHROPIC_API_KEY']).toBe('synthetic-anthropic');
    expect(values['OPENAI_API_KEY']).toBe('synthetic-openai');
    expect(values['CODEX_HOME']).toBe('C:\\synthetic\\codex-home');
    expect(values['AWS_SECRET_ACCESS_KEY']).toBeNull();
    expect(values['GITHUB_TOKEN']).toBeNull();
    expect(values['http_proxy']).toBe('http://synthetic-proxy.example');
    expect(values['META_API_KEY']).toBeNull();
    expect(result.standardOutput).not.toContain('synthetic-sentinel');
    expect(result.standardOutput).not.toContain('synthetic-aws');
    expect(result.standardOutput).not.toContain('synthetic-github-token');
    expect(result.standardOutput).not.toContain('synthetic-meta');
    const allowlist: readonly string[] = CLI_CHILD_ENVIRONMENT_ALLOWLIST;
    const unexpected = keyNames.filter(
      (name) => !allowlist.includes(name) && name !== 'LOGONSERVER',
    );
    expect(unexpected).toEqual([]);
    expect(keyNames).toContain('PATH');
    expect(keyNames).not.toContain('KOMA_UNTRUSTED_SENTINEL');
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
    expect(environment.calls[0]?.env).toEqual(CHILD_ENVIRONMENT);
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
    expect(
      buildClaudeCodeArguments({
        systemPrompt: 'system',
        responseJsonSchema: '{}',
        model: 'claude-opus-5-5',
      }),
    ).toEqual([
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
      '--model',
      'claude-opus-5-5',
      '--system-prompt',
      'system',
      '--json-schema',
      '{}',
    ]);
    const withoutModel = buildClaudeCodeArguments({
      systemPrompt: 'system',
      responseJsonSchema: '{}',
      model: null,
    });
    expect(withoutModel).not.toContain('--model');
    expect(withoutModel).not.toContain('--bare');
    expect(withoutModel).not.toContain('--dangerously-skip-permissions');
    expect(withoutModel).not.toContain('system prompt text that must stay on stdin');
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
    expect(call?.env).toEqual(CHILD_ENVIRONMENT);
    expect(call?.arguments).toEqual(
      expect.arrayContaining(['--safe-mode', '--restricted', '--no-chrome', '--strict-mcp-config']),
    );
    expect(call?.arguments).not.toContain('--bare');
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
    expect(buildCodexArguments({ workingDirectory: directory, model: null })).toEqual([
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--color',
      'never',
      '--ignore-user-config',
      '--ignore-rules',
      '--disable',
      'hooks',
      '--disable',
      'plugins',
      '--disable',
      'plugin_sharing',
      '--disable',
      'remote_plugin',
      '--disable',
      'browser_use',
      '--disable',
      'browser_use_external',
      '--disable',
      'browser_use_full_cdp_access',
      '--disable',
      'computer_use',
      '--disable',
      'shell_tool',
      '--cd',
      directory,
      '--output-schema',
      join(directory, 'response-schema.json'),
      '--output-last-message',
      join(directory, 'answer.json'),
      '-',
    ]);
    const withModel = buildCodexArguments({ workingDirectory: directory, model: 'gpt-5.4' });
    expect(withModel[withModel.indexOf('--model') + 1]).toBe('gpt-5.4');
    expect(withModel.indexOf('--cd')).toBeGreaterThan(withModel.lastIndexOf('--disable'));
    expect(withModel).not.toContain('--dangerously-bypass-approvals-and-sandbox');
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
    expect(environment.calls[0]?.env).toEqual(CHILD_ENVIRONMENT);
    expect(environment.calls[0]?.arguments).toEqual(
      expect.arrayContaining([
        '--ignore-user-config',
        '--ignore-rules',
        '--disable',
        'hooks',
        'plugins',
        'plugin_sharing',
        'remote_plugin',
        'browser_use',
        'browser_use_external',
        'browser_use_full_cdp_access',
        'computer_use',
        'shell_tool',
      ]),
    );
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
