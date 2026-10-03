import { createSeededIdGenerator, flattenElements } from '@koma-motion/core';
import {
  buildKoma,
  buildPresentation,
  buildProject,
  buildShape,
  buildText,
  FIXTURE_TIMESTAMP,
} from '@koma-motion/core/testing';
import { describe, expect, it } from 'vitest';
import { buildGenerationRequest, generationInputSchema } from '../contract/request';
import { mergeSelectedKoma } from '../conversion/selectedKoma';
import { presentationGenerationPromptV8 } from '../prompts/presentationGeneration';
import { buildResponse } from '../testing/fixtures';
import { validateAgentResponse } from '../validation/validateResponse';

const entry = {
  id: 'generation-proposal',
  createdAt: FIXTURE_TIMESTAMP,
  providerId: 'mock',
  userRequest: 'Revise',
  status: 'succeeded' as const,
  summary: 'Revised Koma',
  warnings: [],
};
function fixture() {
  const target = buildKoma({
    id: 'middle',
    title: 'Middle',
    elements: [buildText({ id: 'original', persistentId: 'title' })],
  });
  return buildProject({
    presentation: buildPresentation({
      title: 'Keep deck title',
      komas: [
        buildKoma({ id: 'first', elements: [] }),
        target,
        buildKoma({
          id: 'last',
          elements: [buildShape({ id: 'other-element', persistentId: 'other-object' })],
        }),
      ],
    }),
  });
}

describe('selected-Koma generation', () => {
  it('validates an explicit current target, includes full content and forces one response', () => {
    const project = fixture();
    const input = generationInputSchema.parse({
      userRequest: 'Revise',
      targetKomaId: 'middle',
      objective: null,
      audience: null,
      requestedKomaCount: 10,
    });
    const request = buildGenerationRequest(project, input);
    expect(request.targetKoma).toEqual(project.presentation.komas[1]);
    expect(request.requestedKomaCount).toBe(1);
    expect(request.constraints.maxKomas).toBe(1);
    expect(validateAgentResponse(buildResponse(), request).ok).toBe(false);
    expect(() => buildGenerationRequest(project, { ...input, targetKomaId: 'missing' })).toThrow(
      /no longer exists/,
    );
    expect(generationInputSchema.safeParse({ ...input, targetKomaId: '../main' }).success).toBe(
      false,
    );
    const prompt = presentationGenerationPromptV8.render({ request, responseJsonSchema: {} });
    expect(prompt.user).toContain('exactly ONE Koma');
    expect(prompt.user).toContain('<<<UNTRUSTED_DATA>>>');
    expect(prompt.user).toContain('"id":"middle"');
    expect(prompt.user).not.toContain('Your response replaces it.');
  });

  it('preserves neighboring Komas/metadata/motion and reconciles continuing and new identities', () => {
    const project = fixture();
    const proposed = buildKoma({
      id: 'untrusted-id',
      title: 'Revised',
      elements: [
        buildText({ id: 'collides', persistentId: 'title', content: { text: 'Updated' } }),
        buildShape({ id: 'other-element', persistentId: 'other-object' }),
      ],
    });
    const next = mergeSelectedKoma(
      project,
      'middle',
      proposed,
      [],
      entry,
      createSeededIdGenerator('selected'),
    );
    expect(next.presentation.komas[0]).toBe(project.presentation.komas[0]);
    expect(next.presentation.komas[2]).toBe(project.presentation.komas[2]);
    expect(next.presentation.transitions).toBe(project.presentation.transitions);
    expect(next.presentation.title).toBe('Keep deck title');
    expect(next.presentation.komas[1]?.id).toBe('middle');
    const elements = flattenElements(next.presentation.komas[1]?.elements ?? []);
    expect(elements[0]?.id).toBe('original');
    expect(elements[0]?.persistentId).toBe('title');
    expect(elements[1]?.id).not.toBe('other-element');
    expect(elements[1]?.persistentId).not.toBe('other-object');
    expect(next.generationHistory).toEqual([entry]);
    expect(project.presentation.komas[1]?.title).toBe('Middle');
  });
});
