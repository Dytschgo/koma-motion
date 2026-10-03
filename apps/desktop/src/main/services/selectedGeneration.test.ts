import { GenerationRunner, ProviderRegistry } from '@koma-motion/agent-runtime';
import { createSeededIdGenerator, type AssetReference } from '@koma-motion/core';
import { buildKoma, buildPresentation, buildProject } from '@koma-motion/core/testing';
import { describe, expect, it } from 'vitest';
import {
  buildResponse,
  ScriptedProvider,
} from '../../../../../packages/agent-runtime/src/testing/fixtures';
import { generatePresentation } from './generation';

describe('selected generation main boundary', () => {
  const target = buildKoma({ id: 'middle', title: 'Middle', holdDurationMs: 2500 });
  const project = buildProject({
    presentation: buildPresentation({
      komas: [buildKoma({ id: 'first' }), target, buildKoma({ id: 'last' })],
    }),
  });
  const input = {
    userRequest: 'Revise only Middle',
    targetKomaId: target.id,
    requestedKomaCount: 1,
    objective: null,
    audience: null,
  };
  function run(provider: ScriptedProvider, candidate = project, targetKomaId = target.id) {
    return generatePresentation({
      runner: new GenerationRunner({ registry: new ProviderRegistry([provider]) }),
      executionId: 'selected',
      providerId: provider.id,
      project: candidate,
      input: { ...input, targetKomaId },
      idGenerator: createSeededIdGenerator('selected'),
      now: () => new Date('2026-10-03T00:00:00Z'),
      onStatus: () => undefined,
    });
  }

  it('returns a one-Koma proposal without mutating the full saved project', async () => {
    const response = buildResponse();
    response.komas = response.komas.slice(0, 1);
    response.transitions = [];
    const provider = new ScriptedProvider([JSON.stringify(response)]);
    const result = await run(provider);
    expect(result.status).toBe('succeeded');
    if (result.status !== 'succeeded') throw new Error(result.error.message);
    expect(result.presentation.komas).toHaveLength(1);
    expect(result.historyEntry.summary).toMatch(/^Proposed changes to Middle/);
    expect(project.presentation.komas).toHaveLength(3);
    expect(project.presentation.komas[1]?.holdDurationMs).toBe(2500);
    expect(project.generationHistory).toEqual([]);
  });

  it('rejects a missing target before consulting a provider and multiple response Komas after repair', async () => {
    const provider = new ScriptedProvider([
      JSON.stringify(buildResponse()),
      JSON.stringify(buildResponse()),
    ]);
    await expect(run(provider, project, 'deleted')).rejects.toThrow(/no longer exists/);
    expect(provider.contexts).toHaveLength(0);
    const result = await run(provider);
    expect(result.status).toBe('failed');
    expect(provider.contexts).toHaveLength(2);
    expect(project.generationHistory).toEqual([]);
  });

  it('does not advertise schema-valid unreadable embedded bytes as an available image', async () => {
    const asset: AssetReference = {
      id: 'corrupt',
      name: 'Corrupt',
      type: 'image',
      mediaType: 'image/png',
      projectPath: 'assets/corrupt.png',
      metadata: {},
      embeddedData: { encoding: 'base64', data: 'aGVsbG8=' },
    };
    const response = buildResponse();
    response.komas = response.komas.slice(0, 1);
    response.transitions = [];
    const provider = new ScriptedProvider([JSON.stringify(response)]);
    const result = await run(provider, { ...project, assets: [asset] });
    expect(result.status).toBe('succeeded');
    expect(provider.contexts[0]?.prompt.user).not.toContain('"id":"corrupt"');
    expect(asset.embeddedData?.data).toBe('aGVsbG8=');
  });
});
