import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_SYSTEM_INSTRUCTIONS_LENGTH } from '@koma-motion/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  instructionTemplateActionSchema,
  instructionTemplateLibrarySchema,
} from '../../shared/instructionTemplates';
import {
  InstructionTemplateLibrary,
  INSTRUCTION_TEMPLATES_FILE,
  MAX_TEMPLATE_LIBRARY_BYTES,
} from './instructionTemplates';

let directory: string;
let library: InstructionTemplateLibrary;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'koma-instructions-'));
  library = new InstructionTemplateLibrary(() => directory);
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('app instruction templates', () => {
  it('creates, renames, duplicates and deletes, and survives a new instance', async () => {
    expect(await library.list()).toEqual([]);
    const instructions = ' Keep trailing whitespace. \n日本語';
    const [created] = await library.change({ action: 'create', name: ' Technical ', instructions });
    expect(created).toMatchObject({ name: 'Technical', instructions });
    if (created === undefined) throw new Error('Expected template');
    const renamed = await library.change({
      action: 'rename',
      id: created.id,
      name: 'Plain language',
    });
    expect(renamed[0]?.instructions).toBe(instructions);
    const duplicated = await library.change({ action: 'duplicate', id: created.id, name: 'Copy' });
    expect(duplicated).toHaveLength(2);
    expect(duplicated[1]?.id).not.toBe(created.id);
    expect(duplicated[1]?.instructions).toBe(instructions);
    await library.change({ action: 'delete', id: created.id });
    expect(await new InstructionTemplateLibrary(() => directory).list()).toEqual([duplicated[1]]);
    expect(JSON.parse(await readFile(join(directory, INSTRUCTION_TEMPLATES_FILE), 'utf8'))).toEqual(
      { version: 1, templates: [duplicated[1]] },
    );
  });

  it('serializes simultaneous mutations without losing templates', async () => {
    await Promise.all(
      ['First', 'Second', 'Third'].map((name) =>
        library.change({ action: 'create', name, instructions: name }),
      ),
    );
    expect((await library.list()).map((template) => template.name)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
  });

  it('rejects too-long input, credentials fields, paths, duplicate ids and excess entries', async () => {
    const instructions = 'x'.repeat(MAX_SYSTEM_INSTRUCTIONS_LENGTH);
    await library.change({ action: 'create', name: 'Limit', instructions });
    const path = join(directory, INSTRUCTION_TEMPLATES_FILE);
    const before = await readFile(path, 'utf8');
    await expect(
      library.change({ action: 'create', name: 'Over', instructions: `${instructions}x` }),
    ).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(
      instructionTemplateActionSchema.safeParse({
        action: 'create',
        name: 'X',
        instructions: '',
        apiKey: 'forbidden',
      }).success,
    ).toBe(false);
    expect(
      instructionTemplateActionSchema.safeParse({ action: 'delete', id: '../other.json' }).success,
    ).toBe(false);
    const template = { id: randomUUID(), name: 'X', instructions: '' };
    expect(
      instructionTemplateLibrarySchema.safeParse({ version: 1, templates: [template, template] })
        .success,
    ).toBe(false);
    const templates = Array.from({ length: 100 }, () => ({ ...template, id: randomUUID() }));
    await writeFile(path, JSON.stringify({ version: 1, templates }));
    await expect(
      library.change({ action: 'duplicate', id: templates[0]!.id, name: 'One too many' }),
    ).rejects.toThrow();
    expect(await library.list()).toHaveLength(100);
  });

  it.each([
    '{broken',
    JSON.stringify({
      version: 1,
      templates: [{ id: randomUUID(), name: 'X', instructions: '', apiKey: 'forbidden' }],
    }),
    'x'.repeat(MAX_TEMPLATE_LIBRARY_BYTES + 1),
  ])('keeps an invalid library intact rather than replacing it with defaults', async (text) => {
    const path = join(directory, INSTRUCTION_TEMPLATES_FILE);
    await writeFile(path, text);
    await expect(library.list()).rejects.toThrow();
    await expect(
      library.change({ action: 'create', name: 'X', instructions: '' }),
    ).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe(text);
  });

  it('preserves the library when replacement fails and recovers on the next operation', async () => {
    const path = join(directory, INSTRUCTION_TEMPLATES_FILE);
    await mkdir(path);
    await expect(
      library.change({ action: 'create', name: 'Kept in UI', instructions: 'text' }),
    ).rejects.toThrow();
    await rm(path, { recursive: true });
    expect(
      await library.change({ action: 'create', name: 'Retry', instructions: 'text' }),
    ).toHaveLength(1);
  });

  it('keeps previously saved templates on a write failure and allows retry', async () => {
    const before = await library.change({
      action: 'create',
      name: 'Original',
      instructions: 'Keep me',
    });
    let fail = true;
    const { writeFileAtomic } = await import('@koma-motion/project-format/node');
    const failing = new InstructionTemplateLibrary(
      () => directory,
      async (path, text) => {
        if (fail) throw new Error('Synthetic disk failure');
        await writeFileAtomic(path, text);
      },
    );
    await expect(
      failing.change({ action: 'rename', id: before[0]!.id, name: 'New name' }),
    ).rejects.toThrow('Synthetic disk failure');
    expect(await failing.list()).toEqual(before);
    fail = false;
    expect(
      (await failing.change({ action: 'rename', id: before[0]!.id, name: 'New name' }))[0]?.name,
    ).toBe('New name');
  });
});
