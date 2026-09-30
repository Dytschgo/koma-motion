import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MAX_SYSTEM_INSTRUCTIONS_LENGTH, komaProjectSchema } from '@koma-motion/core';
import { buildProject } from '@koma-motion/core/testing';
import { describe, expect, it } from 'vitest';
import { parseProject } from './parse';
import { serialiseProject } from './serialise';
import { readProjectFile, writeProjectFile } from './node/files';
import { migrateToVersion } from './migrations';

describe('project instructions', () => {
  it('migrates version 1 to empty instructions without activating extension text', () => {
    const project = buildProject();
    const result = migrateToVersion(
      {
        ...project,
        schemaVersion: 1,
        systemInstructions: 'Legacy unknown extension',
      },
      1,
      2,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.document).toEqual({ ...project, schemaVersion: 2 });
    expect(result.value.migratedFrom).toBe(1);
    const { systemInstructions: omitted, ...missing } = project;
    expect(omitted).toBe('');
    const legacy = parseProject(JSON.stringify({ ...missing, schemaVersion: 1 }));
    expect(legacy.ok && legacy.value.project.systemInstructions).toBe('');
    expect(komaProjectSchema.parse(missing).systemInstructions).toBe('');
  });

  it('rejects overlong instructions without truncating and accepts the exact limit', () => {
    const text = 'x'.repeat(MAX_SYSTEM_INSTRUCTIONS_LENGTH);
    expect(
      komaProjectSchema.parse(buildProject({ systemInstructions: text })).systemInstructions,
    ).toBe(text);
    expect(serialiseProject(buildProject({ systemInstructions: `${text}x` })).ok).toBe(false);
    expect(parseProject(JSON.stringify({ ...buildProject(), systemInstructions: 42 })).ok).toBe(
      false,
    );
  });

  it('saves and reopens instructions verbatim in a real .koma file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'koma-instructions-file-'));
    try {
      const path = join(directory, 'instructions.koma');
      const project = buildProject({
        systemInstructions: '  Use Swiss spelling.\nKeep ä ö ü and 日本語.  ',
      });
      expect((await writeProjectFile(path, project)).ok).toBe(true);
      const reopened = await readProjectFile(path);
      expect(reopened.ok).toBe(true);
      if (reopened.ok) expect(reopened.value.project).toEqual(project);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
