import { describe, expect, it } from 'vitest';
import { MockAgentProvider } from '../providers/mock/MockAgentProvider';
import { ProviderRegistry } from '../providers/registry';
import type { ExecutionStatusEvent } from '../providers/types';
import {
  buildRequest,
  buildResponse,
  ScriptedProvider,
  type ScriptedAnswer,
} from '../testing/fixtures';
import { GenerationRunner, type PresentationGenerationResult } from './GenerationRunner';

const valid = JSON.stringify(buildResponse());

function setup(answers: readonly ScriptedAnswer[]): {
  provider: ScriptedProvider;
  runner: GenerationRunner;
  events: ExecutionStatusEvent[];
  run: (options?: { timeoutMs?: number; model?: string }) => Promise<PresentationGenerationResult>;
} {
  const provider = new ScriptedProvider(answers);
  const runner = new GenerationRunner({ registry: new ProviderRegistry([provider]) });
  const events: ExecutionStatusEvent[] = [];
  return {
    provider,
    runner,
    events,
    run: (options = {}) =>
      runner.execute({
        executionId: 'execution-1',
        providerId: provider.id,
        request: buildRequest(),
        onStatus: (event) => events.push(event),
        ...options,
      }),
  };
}

describe('ProviderRegistry', () => {
  it('lists providers in the order they were registered', () => {
    const registry = new ProviderRegistry([
      new MockAgentProvider(),
      new ScriptedProvider([], 'second'),
    ]);
    expect(registry.list().map((provider) => provider.id)).toEqual(['mock', 'second']);
    expect(registry.get('second')?.displayName).toBe('Scripted provider');
    expect(registry.get('missing')).toBeUndefined();
  });

  it('rejects a second provider with the same id', () => {
    const registry = new ProviderRegistry([new MockAgentProvider()]);
    expect(() => {
      registry.register(new MockAgentProvider());
    }).toThrow('already registered');
  });

  it('detects every provider and survives a provider that throws', async () => {
    const broken = new ScriptedProvider([], 'broken');
    broken.detect = () => Promise.reject(new Error('secret detail'));
    const unavailable = new ScriptedProvider([], 'unavailable');
    unavailable.detection = {
      ...unavailable.detection,
      availability: 'unavailable',
      version: null,
      message: 'Not installed.',
    };
    const registry = new ProviderRegistry([new MockAgentProvider(), broken, unavailable]);

    const detected = await registry.detectAll(() => new Date('2026-01-15T10:30:00.000Z'));

    expect(detected.map((entry) => [entry.metadata.id, entry.detection.availability])).toEqual([
      ['mock', 'available'],
      ['broken', 'error'],
      ['unavailable', 'unavailable'],
    ]);
    expect(detected[1]?.detection.message).toBe('Scripted provider could not be checked.');
    expect(JSON.stringify(detected)).not.toContain('secret detail');
  });
});

describe('GenerationRunner', () => {
  it('runs the mock provider from request to validated response', async () => {
    const runner = new GenerationRunner({
      registry: new ProviderRegistry([new MockAgentProvider({ delayMs: 0 })]),
    });
    const events: ExecutionStatusEvent[] = [];

    const result = await runner.execute({
      executionId: 'execution-1',
      providerId: 'mock',
      request: buildRequest(),
      onStatus: (event) => events.push(event),
    });

    expect(result.status).toBe('succeeded');
    if (result.status === 'succeeded') {
      expect(result.response.komas).toHaveLength(3);
      expect(result.repaired).toBe(false);
      expect(result.diagnostics.attempts).toHaveLength(1);
      expect(result.diagnostics.promptTemplate).toBe('presentation-generation@1');
    }
    expect([...new Set(events.map((event) => event.phase))]).toEqual([
      'preparing',
      'detecting',
      'generating',
      'validating',
      'succeeded',
    ]);
    expect(runner.isRunning('execution-1')).toBe(false);
  });

  it('accepts structured output of a provider after validating it', async () => {
    const { run } = setup([{ structured: buildResponse() }]);
    expect((await run()).status).toBe('succeeded');
  });

  it('validates structured output like any other output', async () => {
    const { run } = setup([{ structured: { komas: 'none' } }, { structured: { komas: 'none' } }]);
    const result = await run();
    expect(result.status).toBe('failed');
  });

  it('passes the model and the prompt to the provider', async () => {
    const { run, provider } = setup([valid]);
    await run({ model: 'claude-opus-5-5' });
    expect(provider.contexts[0]?.model).toBe('claude-opus-5-5');
    expect(provider.contexts[0]?.prompt.user).toContain('# Brand Kit');
    expect(provider.contexts[0]?.prompt.user).toContain('"primary": "#FF5A36"');
    expect(provider.contexts[0]?.prompt.system).toContain('persistentId');
  });

  it('repairs a malformed response once', async () => {
    const { run, provider, events } = setup(['Sorry, here you go: {"komas": 3}', valid]);

    const result = await run();

    expect(result.status).toBe('succeeded');
    if (result.status === 'succeeded') {
      expect(result.repaired).toBe(true);
      expect(result.diagnostics.attempts.map((attempt) => [attempt.kind, attempt.outcome])).toEqual(
        [
          ['generation', 'rejected'],
          ['repair', 'completed'],
        ],
      );
    }
    expect(events.map((event) => event.phase)).toContain('repairing');
    const repairPrompt = provider.contexts[1]?.prompt;
    expect(repairPrompt?.templateId).toBe('presentation-repair');
    expect(repairPrompt?.user).toContain('# Correction required');
    expect(repairPrompt?.user).toContain('{"komas": 3}');
  });

  it('gives up after one repair attempt', async () => {
    const { run, provider } = setup(['not json', 'still not json', valid]);

    const result = await run();

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error.code).toBe('noStructuredOutput');
      expect(result.diagnostics.attempts).toHaveLength(2);
    }
    expect(provider.contexts).toHaveLength(2);
  });

  it('reports the validation issues of a rejected response', async () => {
    const broken = structuredClone(buildResponse());
    Object.assign(broken.transitions[0] ?? {}, { fromKoma: 'nowhere' });
    const { run } = setup([JSON.stringify(broken), JSON.stringify(broken)]);

    const result = await run();

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error.code).toBe('invalidResponse');
      expect(result.error.issues.map((issue) => issue.code)).toEqual(['invalidReference']);
    }
  });

  it('reports cancellation', async () => {
    const { run, runner, events } = setup([{ waitForAbort: true }]);
    const pending = run();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runner.isRunning('execution-1')).toBe(true);

    expect(runner.cancel('execution-1')).toBe(true);
    const result = await pending;

    expect(result.status).toBe('cancelled');
    if (result.status === 'cancelled') {
      expect(result.error.code).toBe('cancelled');
    }
    expect(events.at(-1)?.phase).toBe('cancelled');
    expect(runner.isRunning('execution-1')).toBe(false);
    expect(runner.cancel('execution-1')).toBe(false);
  });

  it('stops a provider that ignores cancellation', async () => {
    const provider = new ScriptedProvider([]);
    provider.generatePresentation = () => new Promise(() => undefined);
    const runner = new GenerationRunner({ registry: new ProviderRegistry([provider]) });
    const pending = runner.execute({
      executionId: 'execution-1',
      providerId: provider.id,
      request: buildRequest(),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    runner.cancel('execution-1');
    expect((await pending).status).toBe('cancelled');
  });

  it('reports a timeout', async () => {
    const { run, events } = setup([{ waitForAbort: true }]);

    const result = await run({ timeoutMs: 20 });

    expect(result.status).toBe('timedOut');
    if (result.status === 'timedOut') {
      expect(result.error.code).toBe('timedOut');
      expect(result.error.message).toContain('did not finish');
    }
    expect(events.at(-1)?.phase).toBe('timedOut');
  });

  it('fails for a provider that does not exist', async () => {
    const { runner } = setup([]);
    const result = await runner.execute({
      executionId: 'execution-1',
      providerId: 'missing',
      request: buildRequest(),
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error.code).toBe('providerNotFound');
    }
  });

  it('fails for a provider that is not available', async () => {
    const { run, provider } = setup([valid]);
    provider.detection = {
      ...provider.detection,
      availability: 'unavailable',
      message: 'Scripted provider is not installed.',
    };
    const result = await run();
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toMatchObject({
        code: 'providerUnavailable',
        message: 'Scripted provider is not installed.',
      });
    }
    expect(provider.contexts).toHaveLength(0);
  });

  it('passes on errors reported by the provider without retrying', async () => {
    const { run, provider } = setup([{ fail: ['executionFailed', 'Exit code 1.'] }, valid]);
    const result = await run();
    expect(result.status).toBe('failed');
    expect(provider.contexts).toHaveLength(1);
  });

  it('hides the details of unexpected provider errors', async () => {
    const { run } = setup([{ throwError: 'token sk-secret-value leaked' }]);
    const result = await run();
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error.code).toBe('internalError');
      expect(JSON.stringify(result)).not.toContain('sk-secret-value');
    }
  });

  it('rejects an invalid request before the provider starts', async () => {
    const provider = new ScriptedProvider([valid]);
    const runner = new GenerationRunner({ registry: new ProviderRegistry([provider]) });
    const result = await runner.execute({
      executionId: 'execution-1',
      providerId: provider.id,
      request: { ...buildRequest(), userRequest: '   ' },
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error.code).toBe('invalidRequest');
    }
    expect(provider.contexts).toHaveLength(0);
  });
});
