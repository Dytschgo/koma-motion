import {
  buildKoma,
  buildPresentation,
  buildProject,
  buildShape,
  buildText,
} from '@koma-motion/core/testing';
import type { KomaProject } from '@koma-motion/core';
import { buildTransition } from '@koma-motion/motion-engine';
import { describe, expect, it } from 'vitest';
import {
  buildTransitionRegenerationRequest,
  getTransitionResponseJsonSchema,
  type TransitionRegenerationRequest,
} from '../contract/transition';
import { MockAgentProvider } from '../providers/mock/MockAgentProvider';
import { ProviderRegistry } from '../providers/registry';
import type { ExecutionStatusEvent } from '../providers/types';
import { ScriptedProvider, type ScriptedAnswer } from '../testing/fixtures';
import { validateTransitionResponse } from '../validation/validateTransitionResponse';
import { GenerationRunner } from './GenerationRunner';

function staleProject(): KomaProject {
  const mover = buildShape({
    id: 'mover-1',
    persistentId: 'mover',
    name: 'Mover',
    position: { x: 0, y: 0 },
  });
  const caption = buildText({ id: 'caption-1', persistentId: 'caption', name: 'Caption' });
  const from = buildKoma({ id: 'koma-1', title: 'Start', elements: [mover, caption] });
  const to = buildKoma({
    id: 'koma-2',
    title: 'End',
    elements: [{ ...mover, id: 'mover-2', position: { x: 400, y: 0 } }],
  });
  const built = buildTransition({ id: 'transition-1', from, to });
  if (!built.ok) throw new Error('Expected a transition');
  const edited = { ...to, elements: [{ ...mover, id: 'mover-2', position: { x: 800, y: 0 } }] };
  return buildProject({
    systemInstructions: 'Keep motion calm.',
    presentation: buildPresentation({
      komas: [from, edited],
      transitions: [built.value.transition],
    }),
  });
}

function request(): TransitionRegenerationRequest {
  const built = buildTransitionRegenerationRequest(staleProject(), 'transition-1');
  if (!built.ok) throw new Error(built.error.message);
  return built.value;
}

const validSettings = {
  strategy: 'staged',
  durationMs: 1200,
  easing: 'easeOut',
  rationale: 'The mover travels further now.',
};

describe('buildTransitionRegenerationRequest', () => {
  it('describes both Komas and the motion derived from them as they are now', () => {
    const value = request();
    expect(value.source).toMatchObject({ number: 1, title: 'Start' });
    expect(value.target).toMatchObject({ number: 2, title: 'End' });
    expect(value.motion).toEqual(
      expect.arrayContaining([
        { persistentId: 'mover', operations: ['move'] },
        { persistentId: 'caption', operations: ['fadeOut'] },
      ]),
    );
    expect(value.motion).toHaveLength(2);
    expect(value.current).toMatchObject({ strategy: 'continuous', easing: 'easeInOut' });
    expect(value.systemInstructions).toBe('Keep motion calm.');
    expect(value.durationRangeMs).toEqual({ min: 100, max: 10000 });
  });

  it('refuses a missing transition, a separated pair and Komas that cannot be compared', () => {
    const project = staleProject();
    expect(buildTransitionRegenerationRequest(project, 'missing')).toMatchObject({
      ok: false,
      error: { code: 'invalidRequest', message: 'This transition no longer exists.' },
    });

    const [first, second] = project.presentation.komas;
    if (first === undefined || second === undefined) throw new Error('Expected two Komas');
    const separated = {
      ...project,
      presentation: { ...project.presentation, komas: [first, buildKoma({ id: 'x' }), second] },
    };
    expect(buildTransitionRegenerationRequest(separated, 'transition-1')).toMatchObject({
      ok: false,
      error: { code: 'invalidRequest' },
    });

    const duplicate = buildShape({ id: 'twin-2', persistentId: 'mover' });
    const broken = {
      ...project,
      presentation: {
        ...project.presentation,
        komas: [first, { ...second, elements: [...second.elements, duplicate] }],
      },
    };
    const result = buildTransitionRegenerationRequest(broken, 'transition-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('cannot be compared');
  });
});

describe('validateTransitionResponse', () => {
  it('accepts settings inside the contract', () => {
    expect(validateTransitionResponse(validSettings, request())).toEqual({
      ok: true,
      value: { settings: validSettings, warnings: [] },
    });
  });

  it('names unsupported values and rejects out-of-range or missing fields', () => {
    const unsupported = validateTransitionResponse(
      { ...validSettings, easing: 'bounce' },
      request(),
    );
    expect(unsupported).toMatchObject({
      ok: false,
      error: {
        code: 'invalidResponse',
        issues: [{ code: 'unsupportedTransition', path: 'easing' }],
      },
    });
    for (const output of [
      { ...validSettings, durationMs: 60000 },
      { ...validSettings, rationale: '  ' },
      { strategy: 'staged' },
      'not an object',
    ]) {
      expect(validateTransitionResponse(output, request())).toMatchObject({
        ok: false,
        error: { code: 'invalidResponse' },
      });
    }
  });

  it('publishes a flat JSON schema for structured output', () => {
    expect(getTransitionResponseJsonSchema()).toMatchObject({
      type: 'object',
      required: ['strategy', 'durationMs', 'easing', 'rationale'],
    });
  });
});

describe('GenerationRunner.executeTransition', () => {
  function setup(answers: readonly ScriptedAnswer[]): {
    provider: ScriptedProvider;
    runner: GenerationRunner;
    events: ExecutionStatusEvent[];
    run: (model?: string) => ReturnType<GenerationRunner['executeTransition']>;
  } {
    const provider = new ScriptedProvider(answers);
    const runner = new GenerationRunner({ registry: new ProviderRegistry([provider]) });
    const events: ExecutionStatusEvent[] = [];
    return {
      provider,
      runner,
      events,
      run: (model) =>
        runner.executeTransition({
          executionId: 'transition-execution-1',
          providerId: provider.id,
          request: request(),
          model: model ?? null,
          onStatus: (event) => events.push(event),
        }),
    };
  }

  it('asks the transition method with the transition prompt and the selected model', async () => {
    const { run, provider } = setup([JSON.stringify(validSettings)]);
    const result = await run('opus');
    expect(result).toMatchObject({ status: 'succeeded', response: validSettings, repaired: false });
    expect(provider.tasks).toEqual(['transition']);
    expect(provider.contexts[0]?.model).toBe('opus');
    expect(provider.contexts[0]?.prompt.templateId).toBe('transition-regeneration');
    expect(provider.contexts[0]?.prompt.user).toContain('<<<UNTRUSTED_DATA>>>');
    expect(provider.contexts[0]?.prompt.user).toContain('"Keep motion calm."');
    expect(provider.contexts[0]?.prompt.responseJsonSchema).toEqual(
      getTransitionResponseJsonSchema(),
    );
  });

  it('repairs invalid output once and then rejects it', async () => {
    const repaired = setup([
      JSON.stringify({ ...validSettings, easing: 'bounce' }),
      JSON.stringify(validSettings),
    ]);
    expect(await repaired.run()).toMatchObject({ status: 'succeeded', repaired: true });
    expect(repaired.provider.contexts[1]?.prompt.templateId).toBe('transition-repair');
    expect(repaired.provider.contexts[1]?.prompt.user).toContain('bounce');

    const rejected = setup(['{"strategy":"sideways"}', '{"strategy":"staged"}']);
    const result = await rejected.run();
    expect(result).toMatchObject({ status: 'failed', error: { code: 'invalidResponse' } });
    expect(rejected.provider.tasks).toEqual(['transition', 'transition']);
  });

  it('reports provider failures, unavailability and cancellation', async () => {
    const failing = setup([{ fail: ['executionFailed', 'Claude Code reported an error.'] }]);
    expect(await failing.run()).toMatchObject({
      status: 'failed',
      error: { code: 'executionFailed', message: 'Claude Code reported an error.' },
    });

    const unavailable = setup([]);
    unavailable.provider.detection = {
      ...unavailable.provider.detection,
      availability: 'unavailable',
      message: 'Claude Code is not installed.',
    };
    expect(await unavailable.run()).toMatchObject({
      status: 'failed',
      error: { code: 'providerUnavailable', message: 'Claude Code is not installed.' },
    });

    const waiting = setup([{ waitForAbort: true }]);
    const pending = waiting.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(waiting.runner.cancel('transition-execution-1')).toBe(true);
    expect(await pending).toMatchObject({ status: 'cancelled', error: { code: 'cancelled' } });
  });

  it('refuses a request that does not match the contract', async () => {
    const { runner } = setup([]);
    const result = await runner.executeTransition({
      executionId: 'transition-execution-1',
      providerId: 'scripted',
      request: { ...request(), allowedEasings: [] },
    });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'invalidRequest' } });
  });

  it('works with the mock provider, which keeps the timing and describes the change', async () => {
    const runner = new GenerationRunner({
      registry: new ProviderRegistry([new MockAgentProvider({ delayMs: 0 })]),
    });
    const result = await runner.executeTransition({
      executionId: 'transition-execution-1',
      providerId: 'mock',
      request: request(),
    });
    expect(result).toMatchObject({
      status: 'succeeded',
      response: {
        strategy: 'continuous',
        easing: 'easeInOut',
        rationale:
          'Redone for the current Komas "Start" and "End": 1 object changes, 1 object leaves.',
      },
    });
  });
});
