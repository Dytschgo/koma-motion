import {
  GenerationRunner,
  MockAgentProvider,
  ProviderRegistry,
  type AgentProvider,
  type ExecutionStatusEvent,
} from '@koma-motion/agent-runtime';
import { ScriptedProvider } from '@koma-motion/agent-runtime/testing';
import type { KomaProject } from '@koma-motion/core';
import { buildKoma, buildPresentation, buildProject, buildShape } from '@koma-motion/core/testing';
import { buildTransition } from '@koma-motion/motion-engine';
import { describe, expect, it } from 'vitest';
import { ipcContract } from '../../shared/ipc';
import { regenerateTransition } from './generation';

const now = (): Date => new Date('2026-09-30T12:00:00.000Z');

function staleProject(providerModel: string | null = null): KomaProject {
  const mover = buildShape({ id: 'mover-1', persistentId: 'mover', position: { x: 0, y: 0 } });
  const from = buildKoma({ id: 'koma-1', title: 'Start', elements: [mover] });
  const to = buildKoma({
    id: 'koma-2',
    title: 'End',
    elements: [{ ...mover, id: 'mover-2', position: { x: 400, y: 0 } }],
  });
  const built = buildTransition({ id: 'transition-1', from, to });
  if (!built.ok) throw new Error('Expected a transition');
  const edited = { ...to, elements: [{ ...mover, id: 'mover-2', position: { x: 900, y: 0 } }] };
  const project = buildProject({
    presentation: buildPresentation({
      komas: [from, edited],
      transitions: [built.value.transition],
    }),
  });
  return {
    ...project,
    agentConfiguration: {
      ...project.agentConfiguration,
      selectedProviderId: 'scripted',
      providers: { scripted: { model: providerModel } },
    },
  };
}

function run(
  provider: AgentProvider,
  project: KomaProject,
  transitionId = 'transition-1',
  events: ExecutionStatusEvent[] = [],
): ReturnType<typeof regenerateTransition> {
  return regenerateTransition({
    runner: new GenerationRunner({ registry: new ProviderRegistry([provider]), now }),
    executionId: 'transition-execution-1',
    providerId: provider.id,
    project,
    transitionId,
    now,
    onStatus: (event) => events.push(event),
  });
}

describe('regenerateTransition', () => {
  it('returns validated settings for the one transition and uses the selected model', async () => {
    const provider = new ScriptedProvider([
      JSON.stringify({
        strategy: 'staged',
        durationMs: 1500,
        easing: 'linear',
        rationale: 'The mover crosses the whole canvas now.',
      }),
    ]);
    const outcome = await run(provider, staleProject('opus'));
    expect(outcome).toMatchObject({
      status: 'succeeded',
      transitionId: 'transition-1',
      settings: {
        strategy: 'staged',
        duration: 1500,
        easing: 'linear',
        rationale: 'The mover crosses the whole canvas now.',
      },
    });
    expect(provider.contexts[0]?.model).toBe('opus');
    expect(
      ipcContract['koma:providers:regenerate-transition'].response.safeParse(outcome).success,
    ).toBe(true);
  });

  it('returns failures in the shape of the contract, without settings', async () => {
    const invalid = await run(
      new ScriptedProvider(['{"strategy":"sideways"}', '{"easing":"bounce"}']),
      staleProject(),
    );
    expect(invalid).toMatchObject({ status: 'failed', error: { code: 'invalidResponse' } });
    expect(invalid).not.toHaveProperty('settings');
    expect(ipcContract['koma:providers:regenerate-transition'].response.parse(invalid)).toEqual(
      invalid,
    );

    const missing = await run(new MockAgentProvider({ delayMs: 0 }), staleProject(), 'missing');
    expect(missing).toMatchObject({
      status: 'failed',
      transitionId: 'missing',
      error: { code: 'invalidRequest', message: 'This transition no longer exists.' },
    });
    expect(
      ipcContract['koma:providers:regenerate-transition'].response.safeParse(missing).success,
    ).toBe(true);
  });

  it('works end to end with the built-in mock provider', async () => {
    const events: ExecutionStatusEvent[] = [];
    const outcome = await run(
      new MockAgentProvider({ delayMs: 0 }),
      staleProject(),
      'transition-1',
      events,
    );
    expect(outcome).toMatchObject({ status: 'succeeded', settings: { strategy: 'continuous' } });
    expect(events.map((event) => event.phase)).toEqual(
      expect.arrayContaining(['detecting', 'generating', 'validating', 'succeeded']),
    );
  });

  it('accepts only requests that name one transition of a valid project', () => {
    const { request } = ipcContract['koma:providers:regenerate-transition'];
    const valid = {
      executionId: 'transition-execution-1',
      providerId: 'mock',
      project: staleProject(),
      transitionId: 'transition-1',
    };
    expect(request.safeParse(valid).success).toBe(true);
    expect(request.safeParse({ ...valid, transitionId: '../x' }).success).toBe(false);
    expect(request.safeParse({ ...valid, extra: true }).success).toBe(false);
  });
});
