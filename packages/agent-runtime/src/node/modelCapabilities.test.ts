import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { providerModelListingSchema, type AgentExecutionContext } from '../providers/types';
import { buildRequest, buildResponse } from '../testing/fixtures';
import { presentationGenerationPromptV2 } from '../prompts/presentationGeneration';
import { getResponseJsonSchema } from '../contract/response';
import {
  discoverModels,
  parseClaudeModels,
  parseCodexModels,
  parseGrokModels,
  validatedReasoning,
} from './modelCapabilities';
import { buildClaudeCodeArguments, ClaudeCodeProvider } from './ClaudeCodeProvider';
import { buildCodexArguments, CodexCliProvider } from './CodexCliProvider';
import { buildGrokArguments, GrokCliProvider } from './GrokCliProvider';
import { createCliEnvironment, type CliEnvironment } from './cliEnvironment';
import { runProcess, type ProcessResult, type ProcessSpecification } from './runProcess';

const claude = [
  {
    value: 'future-model',
    displayName: 'Future model',
    supportsEffort: true,
    supportedEffortLevels: ['quick', 'deep-v2', '64000'],
  },
  { value: 'plain', displayName: 'Plain' },
];
const codex = {
  data: [
    {
      model: 'future-model',
      displayName: 'Future model',
      isDefault: true,
      supportedReasoningEfforts: [{ reasoningEffort: 'deep-v2', description: 'More effort' }],
      defaultReasoningEffort: 'deep-v2',
    },
  ],
  nextCursor: null,
};
const grok = {
  currentModelId: 'future-model',
  availableModels: [
    {
      modelId: 'future-model',
      name: 'Future model',
      _meta: {
        supportsReasoningEffort: true,
        reasoningEffort: 'high',
        reasoningEfforts: [{ id: 'careful', value: 'high', label: 'Careful', default: true }],
      },
    },
    { modelId: 'no-menu', name: 'No menu', _meta: { supportsReasoningEffort: true } },
  ],
};
const completed: ProcessResult = {
  exitCode: 0,
  standardOutput: '',
  standardError: '',
  outputLimitExceeded: false,
  aborted: false,
  startError: null,
};
function environment(
  respond: (spec: ProcessSpecification) => ProcessResult | Promise<ProcessResult>,
): CliEnvironment {
  return {
    resolveExecutable: () => Promise.resolve({ command: 'fixture', prefixArguments: [] }),
    runProcess: vi.fn((spec: ProcessSpecification) => Promise.resolve(respond(spec))),
    childEnvironment: () => ({ SAFE: 'shared' }),
    claudeCodeChildEnvironment: () => ({ SAFE: 'claude' }),
    createWorkingDirectory: () => Promise.resolve('isolated'),
    removeWorkingDirectory: vi.fn(() => Promise.resolve()),
    now: () => new Date('2026-10-03T12:00:00.000Z'),
  };
}
function emit(
  spec: ProcessSpecification,
  message: unknown,
  write: (text: string) => void = vi.fn(),
): void {
  spec.onStandardOutput?.(`${JSON.stringify(message)}\n`, write);
}
function listing() {
  return providerModelListingSchema.parse({
    status: 'listed',
    ...parseClaudeModels(claude),
    checkedAt: '2026-10-03T12:00:00.000Z',
  });
}
function context(
  reasoning: string | null,
  model: string | null = 'future-model',
): AgentExecutionContext {
  return {
    executionId: 'test',
    attempt: 1,
    model,
    reasoning,
    signal: new AbortController().signal,
    prompt: presentationGenerationPromptV2.render({
      request: buildRequest(),
      responseJsonSchema: getResponseJsonSchema(),
    }),
    reportProgress: vi.fn(),
    reportWarning: vi.fn(),
  };
}

describe('capability parsing', () => {
  it('retains flexible tokens and only reports explicit per-model menus', () => {
    expect(parseClaudeModels(claude).models[0]?.reasoning).toEqual({
      status: 'supported',
      choices: ['quick', 'deep-v2', '64000'].map((value) => ({ value, label: value })),
      defaultValue: null,
    });
    expect(parseClaudeModels(claude).models[1]?.reasoning.status).toBe('unsupported');
    expect(parseGrokModels(grok).models[0]?.reasoning).toEqual({
      status: 'supported',
      choices: [{ value: 'careful', label: 'Careful' }],
      defaultValue: 'careful',
    });
    expect(parseGrokModels(grok).models[1]?.reasoning.status).toBe('unsupported');
    expect(
      parseCodexModels({ ...codex, data: [{ ...codex.data[0], hidden: true }] }).models,
    ).toEqual([]);
  });
  it('rejects malformed IDs, effort tokens, duplicates, and unreported defaults', () => {
    expect(() => parseClaudeModels([{ ...claude[0], value: '--unsafe' }])).toThrow();
    expect(() =>
      parseClaudeModels([{ ...claude[0], supportedEffortLevels: ['x\n-c bad'] }]),
    ).toThrow();
    for (const supportedEffortLevels of [['deep', 'deep'], []]) {
      const data = parseClaudeModels([{ ...claude[0], supportedEffortLevels }]);
      const parsed = providerModelListingSchema.safeParse({
        status: 'listed',
        ...data,
        checkedAt: '2026-10-03T12:00:00.000Z',
      });
      expect(parsed.success).toBe(supportedEffortLevels.length === 0);
    }
    const data = parseCodexModels({
      ...codex,
      data: [{ ...codex.data[0], defaultReasoningEffort: 'not-offered' }],
    });
    expect(
      providerModelListingSchema.safeParse({
        status: 'listed',
        ...data,
        checkedAt: '2026-10-03T12:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('metadata-only protocol exchanges', () => {
  it('initializes Claude without a user prompt, drops account data, and cleans up', async () => {
    const env = environment((spec) => {
      expect(JSON.parse(spec.input)).toMatchObject({
        type: 'control_request',
        request: { subtype: 'initialize' },
      });
      expect(spec.env).toEqual({ SAFE: 'claude' });
      emit(spec, {
        type: 'control_response',
        response: {
          request_id: 'koma-models',
          subtype: 'success',
          response: { models: claude, account: { secret: 'private' } },
        },
      });
      return { ...completed, aborted: true };
    });
    const result = await new ClaudeCodeProvider(env).listModels(new AbortController().signal);
    expect(result).toEqual(listing());
    expect(JSON.stringify(result)).not.toContain('private');
    // The methods below are spies; they are not invoked without a receiver.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(env.removeWorkingDirectory).toHaveBeenCalledWith('isolated');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const args = vi.mocked(env.runProcess).mock.calls[0]?.[0].arguments;
    expect(args).toContain('--restricted');
    expect(args).toContain('--no-session-persistence');
  });
  it('waits for Codex initialization and follows all pages', async () => {
    const written: unknown[] = [];
    const env = environment((spec) => {
      const write = (text: string): void => {
        const message: unknown = JSON.parse(text);
        written.push(message);
      };
      emit(spec, { id: 1, result: {} }, write);
      emit(spec, { id: 2, result: { ...codex, nextCursor: 'next' } }, write);
      emit(
        spec,
        {
          id: 3,
          result: {
            data: [
              {
                model: 'plain',
                displayName: 'Plain',
                isDefault: false,
                supportedReasoningEfforts: [],
              },
            ],
            nextCursor: null,
          },
        },
        write,
      );
      return completed;
    });
    const result = await discoverModels(env, 'codex', ['app-server'], new AbortController().signal);
    expect(result.status).toBe('listed');
    if (result.status === 'listed')
      expect(result.models.map((model) => model.id)).toEqual(['future-model', 'plain']);
    expect(written).toEqual([
      { method: 'initialized' },
      { jsonrpc: '2.0', id: 2, method: 'model/list', params: { includeHidden: false, limit: 100 } },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'model/list',
        params: { includeHidden: false, limit: 100, cursor: 'next' },
      },
    ]);
  });
  it('uses Grok model metadata without a session or guessed effort fallback', async () => {
    const env = environment((spec) => {
      emit(spec, { id: 1, result: {} });
      emit(spec, { id: 2, result: { result: grok } });
      return completed;
    });
    const result = await new GrokCliProvider(env).listModels(new AbortController().signal);
    expect(result.status).toBe('listed');
    if (result.status === 'listed') expect(result.models[1]?.reasoning.status).toBe('unsupported');
  });
  it('distinguishes unsupported, invalid data, RPC errors and cancellation', async () => {
    for (const [message, status] of [
      [{ id: 1, error: { code: -32601 } }, 'unsupported'],
      [{ id: 2, error: { code: -32601 } }, 'unsupported'],
      [{ id: 2, error: { code: -32000 } }, 'failed'],
      [{ id: 2, result: { data: 'bad' } }, 'failed'],
    ] as const) {
      const env = environment((spec) => {
        if (message.id !== 1) emit(spec, { id: 1, result: {} });
        emit(spec, message);
        return completed;
      });
      expect((await discoverModels(env, 'codex', [], new AbortController().signal)).status).toBe(
        status,
      );
    }
    const abort = new AbortController();
    abort.abort();
    const env = environment(() => ({ ...completed, aborted: true, standardError: 'token=secret' }));
    const result = await discoverModels(env, 'claude', [], abort.signal);
    expect(result.status).toBe('failed');
    expect(JSON.stringify(result)).not.toContain('secret');
    const missing = { ...env, resolveExecutable: () => Promise.resolve(null) };
    expect((await discoverModels(missing, 'codex', [], new AbortController().signal)).status).toBe(
      'failed',
    );
  });
  it('fails a repeated cursor and never returns a partial catalog', async () => {
    const env = environment((spec) => {
      emit(spec, { id: 1, result: {} });
      emit(spec, { id: 2, result: { ...codex, nextCursor: 'repeat' } });
      emit(spec, { id: 3, result: { ...codex, nextCursor: 'repeat' } });
      return completed;
    });
    expect((await discoverModels(env, 'codex', [], new AbortController().signal)).status).toBe(
      'failed',
    );
  });
  it('falls back to Grok model IDs alone only for an unsupported protocol', async () => {
    const env = environment((spec) => {
      if (spec.arguments[0] === 'models')
        return { ...completed, standardOutput: 'Available models:\n * fixture-model (default)\n' };
      emit(spec, { id: 1, result: {} });
      emit(spec, { id: 2, error: { code: -32601 } });
      return completed;
    });
    const result = await new GrokCliProvider(env).listModels(new AbortController().signal);
    expect(result).toMatchObject({
      status: 'listed',
      models: [{ id: 'fixture-model', reasoning: { status: 'unsupported' } }],
    });
  });
  it('reports unsupported when Grok exposes neither model interface', async () => {
    const env = environment(() => ({
      ...completed,
      exitCode: 2,
      standardError: 'error: unrecognized subcommand',
    }));
    expect(await new GrokCliProvider(env).listModels(new AbortController().signal)).toEqual({
      status: 'unsupported',
    });
  });
  it('exchanges chunked lines through the real process runner and kills only its own child', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'koma-capability-test-'));
    try {
      const file = join(directory, 'fixture.cjs');
      await writeFile(
        file,
        `let buffer=''; process.stdin.on('data', chunk => { buffer+=chunk; let end; while((end=buffer.indexOf('\\n'))!==-1){const msg=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(msg.id===1)process.stdout.write(JSON.stringify({id:1,result:{}})+'\\n');if(msg.method==='model/list'){const line=JSON.stringify({id:msg.id,result:${JSON.stringify(codex)}})+'\\n';process.stdout.write(line.slice(0,20));setTimeout(()=>process.stdout.write(line.slice(20)),10)}}});`,
      );
      const env: CliEnvironment = {
        ...createCliEnvironment(),
        resolveExecutable: () =>
          Promise.resolve({ command: process.execPath, prefixArguments: [file] }),
        runProcess,
      };
      const result = await discoverModels(env, 'codex', [], AbortSignal.timeout(5000));
      expect(result.status).toBe('listed');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('execution reasoning overrides', () => {
  it('all providers pass only freshly confirmed effort through their real execution paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'koma-effort-test-'));
    try {
      for (const Provider of [ClaudeCodeProvider, CodexCliProvider, GrokCliProvider]) {
        const calls: ProcessSpecification[] = [];
        const env: CliEnvironment = {
          ...environment(() => completed),
          createWorkingDirectory: () => Promise.resolve(directory),
          runProcess: async (spec) => {
            calls.push(spec);
            if (spec.keepInputOpen) {
              if (Provider === ClaudeCodeProvider)
                emit(spec, {
                  type: 'control_response',
                  response: {
                    request_id: 'koma-models',
                    subtype: 'success',
                    response: { models: claude },
                  },
                });
              else {
                emit(spec, { id: 1, result: {} });
                emit(spec, {
                  id: 2,
                  result: Provider === CodexCliProvider ? codex : { result: grok },
                });
              }
              return completed;
            }
            const response = buildResponse();
            if (Provider === CodexCliProvider)
              await writeFile(join(directory, 'answer.json'), JSON.stringify(response));
            return {
              ...completed,
              standardOutput: JSON.stringify(
                Provider === ClaudeCodeProvider
                  ? { type: 'result', is_error: false, structured_output: response, result: '' }
                  : { text: '', structuredOutput: response },
              ),
            };
          },
        };
        const provider = new Provider(env);
        expect(provider.metadata.modelCatalog.models).toEqual([]);
        const value = Provider === GrokCliProvider ? 'careful' : 'deep-v2';
        expect((await provider.generatePresentation(buildRequest(), context(value))).ok).toBe(true);
        expect(calls).toHaveLength(2);
        expect(calls[1]?.arguments.join(' ')).toContain(value);
        calls.length = 0;
        const obsolete = context('obsolete');
        expect((await provider.generatePresentation(buildRequest(), obsolete)).ok).toBe(true);
        expect(calls[1]?.arguments.join(' ')).not.toMatch(
          /--(?:reasoning-)?effort|model_reasoning_effort=/,
        );
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(obsolete.reportWarning).toHaveBeenCalled();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('rechecks support and warns instead of sending obsolete, unverified or cross-model values', async () => {
    expect(await validatedReasoning(context('deep-v2'), () => Promise.resolve(listing()))).toBe(
      'deep-v2',
    );
    for (const ctx of [context('old'), context('deep-v2', 'plain')]) {
      expect(await validatedReasoning(ctx, () => Promise.resolve(listing()))).toBeNull();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(ctx.reportWarning).toHaveBeenCalledWith(expect.stringContaining('CLI default'));
    }
    const ctx = context('deep-v2');
    expect(await validatedReasoning(ctx, () => Promise.reject(new Error('secret')))).toBeNull();
    const discover = vi.fn(() => Promise.resolve(listing()));
    expect(await validatedReasoning(context(null), discover)).toBeNull();
    expect(await validatedReasoning(context('deep-v2', null), discover)).toBeNull();
    expect(discover).not.toHaveBeenCalled();
  });
  it('encodes provider-specific arguments without changing defaults', () => {
    const common = {
      model: 'future-model',
      reasoning: 'deep-v2',
      workingDirectory: 'test',
      systemPrompt: '',
      responseJsonSchema: '{}',
      promptFile: 'test/prompt.txt',
    };
    expect(buildClaudeCodeArguments(common)).toContain('--effort');
    expect(buildGrokArguments(common)).toContain('--reasoning-effort');
    expect(buildCodexArguments(common)).toContain('model_reasoning_effort="deep-v2"');
    for (const build of [buildClaudeCodeArguments, buildGrokArguments, buildCodexArguments]) {
      expect(build({ ...common, reasoning: null }).join(' ')).not.toMatch(/effort/);
    }
  });
});
