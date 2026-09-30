import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GenerationRunner,
  ProviderRegistry,
  generationInputSchema,
  MAX_USER_REQUEST_BYTES,
} from '@koma-motion/agent-runtime';
import {
  buildRequest,
  buildResponse,
  ScriptedProvider,
} from '../../../../../packages/agent-runtime/src/testing/fixtures';
import { createSeededIdGenerator, komaProjectSchema } from '@koma-motion/core';
import { buildProject } from '@koma-motion/core/testing';
import { readProjectFile, writeProjectFile } from '@koma-motion/project-format/node';
import { ipcContract } from '../../shared/ipc';
import { applyGeneration, addKoma, reorderKoma } from '../../renderer/src/state/commands';
import { commit, createHistory, undo, redo } from '../../renderer/src/state/history';
import { generatePresentation } from './generation';

describe('larger presentation pipeline', () => {
  it('validates, generates, converts, applies, copies, reorders and reopens more than 200 Komas', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'koma-large-'));
    try {
      const response = buildResponse();
      const source = response.komas[0];
      if (source === undefined) throw new Error('Missing fixture');
      const text = source.elements.find((element) => element.type === 'text');
      if (text === undefined) throw new Error('Missing text');
      response.komas = Array.from({ length: 250 }, (_, index) => ({
        ...source,
        key: `koma-${String(index)}`,
        elements:
          index === 0
            ? Array.from({ length: 65 }, (_, elementIndex) => ({
                ...text,
                persistentId: `text-${String(elementIndex)}`,
                text: 'Long editable text. '.repeat(400),
              }))
            : source.elements,
      }));
      response.transitions = response.komas.slice(1).map((koma, index) => ({
        fromKoma: `koma-${String(index)}`,
        toKoma: koma.key,
        strategy: 'continuous',
        durationMs: 500,
        easing: 'linear',
        rationale: '',
      }));
      const raw = JSON.stringify(response);
      expect(raw.length).toBeGreaterThan(512 * 1024);
      const provider = new ScriptedProvider([raw]);
      const runner = new GenerationRunner({ registry: new ProviderRegistry([provider]) });
      const project = buildProject();
      const input = generationInputSchema.parse({
        userRequest: 'Detailed brief. '.repeat(1000),
        objective: null,
        audience: null,
        requestedKomaCount: 250,
      });
      const generator = createSeededIdGenerator('large');
      const outcome = await generatePresentation({
        runner,
        executionId: 'large',
        providerId: provider.id,
        project,
        input,
        idGenerator: generator,
        now: () => new Date('2026-09-30T00:00:00Z'),
        onStatus: () => undefined,
      });
      expect(outcome.status).toBe('succeeded');
      if (outcome.status !== 'succeeded') throw new Error(outcome.error.message);
      expect(ipcContract['koma:providers:execute'].response.safeParse(outcome).success).toBe(true);
      expect(provider.contexts[0]?.prompt.user).toContain('Number of Komas: 250');
      expect(provider.contexts[0]?.prompt.user).not.toContain('At most 12');
      expect(outcome.presentation.komas).toHaveLength(250);
      expect(outcome.presentation.transitions).toHaveLength(249);
      expect(outcome.presentation.komas[0]?.elements).toHaveLength(65);
      let next = applyGeneration(outcome.presentation, outcome.historyEntry)(project, generator);
      const first = next.presentation.komas[0];
      if (first === undefined) throw new Error('Missing first Koma');
      next = addKoma(first.id)(next, generator);
      const copied = next.presentation.komas[1];
      if (copied === undefined) throw new Error('Missing copied Koma');
      expect(copied.elements.map((element) => element.persistentId)).toEqual(
        first.elements.map((element) => element.persistentId),
      );
      next = reorderKoma(copied.id, 249)(next, generator);
      expect(next.presentation.komas.at(-1)?.id).toBe(copied.id);
      expect(komaProjectSchema.safeParse(next).success).toBe(true);
      const history = commit(createHistory(project), next, { time: 0 });
      expect(undo(history).present).toBe(project);
      expect(redo(undo(history)).present).toBe(next);
      const filePath = join(directory, 'large.koma');
      const saved = await writeProjectFile(filePath, next);
      expect(saved.ok).toBe(true);
      const reopened = await readProjectFile(filePath);
      expect(reopened.ok).toBe(true);
      if (reopened.ok) expect(reopened.value.project).toEqual(next);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('retains malformed-input and UTF-8 input-budget validation', () => {
    const base = { userRequest: 'Brief', objective: null, audience: null, requestedKomaCount: 30 };
    for (const requestedKomaCount of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(generationInputSchema.safeParse({ ...base, requestedKomaCount }).success).toBe(false);
    }
    for (const userRequest of [
      null,
      {},
      '',
      '   ',
      'x'.repeat(MAX_USER_REQUEST_BYTES + 1),
      'あ'.repeat(Math.ceil(MAX_USER_REQUEST_BYTES / 3)),
    ]) {
      expect(generationInputSchema.safeParse({ ...base, userRequest }).success).toBe(false);
    }
    expect(
      generationInputSchema.parse({ ...base, userRequest: 'x'.repeat(MAX_USER_REQUEST_BYTES) })
        .userRequest,
    ).toHaveLength(MAX_USER_REQUEST_BYTES);
    expect(buildRequest().constraints.maxKomas).toBeNull();
  });
});
