import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProject } from '@koma-motion/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readProjectFile, writeFileAtomic, writeProjectFile } from './files';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'koma-format-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('project files', () => {
  it('saves and reopens a project without losing content', async () => {
    const filePath = join(directory, 'story.koma');
    const project = buildProject();

    const saved = await writeProjectFile(filePath, project);
    expect(saved.ok).toBe(true);

    const opened = await readProjectFile(filePath);
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.value.project).toEqual(project);
    }
  });

  it('leaves no temporary files behind', async () => {
    const filePath = join(directory, 'story.koma');
    await writeProjectFile(filePath, buildProject());
    await writeProjectFile(filePath, buildProject({ name: 'Second save' }));
    expect(await readdir(directory)).toEqual(['story.koma']);
  });

  it('does not write an invalid project and keeps the previous file', async () => {
    const filePath = join(directory, 'story.koma');
    await writeProjectFile(filePath, buildProject());
    const before = await readFile(filePath, 'utf8');

    const result = await writeProjectFile(filePath, { ...buildProject(), name: '' });

    expect(result.ok).toBe(false);
    expect(await readFile(filePath, 'utf8')).toBe(before);
    expect(await readdir(directory)).toEqual(['story.koma']);
  });

  it('does not overwrite a project saved by a newer version', async () => {
    const filePath = join(directory, 'future.koma');
    const future = JSON.stringify({ ...buildProject(), schemaVersion: 99 });
    await writeFile(filePath, future, 'utf8');

    const result = await writeProjectFile(filePath, buildProject());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('wouldOverwriteNewerProject');
    }
    expect(await readFile(filePath, 'utf8')).toBe(future);
  });

  it('reports a missing file in plain words', async () => {
    const result = await readProjectFile(join(directory, 'missing.koma'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('fileNotReadable');
      expect(result.error.message).toContain('missing.koma');
      expect(result.error.message).toContain('does not exist');
    }
  });

  it('reports a folder that cannot be written to', async () => {
    const result = await writeProjectFile(
      join(directory, 'missing-folder', 'a.koma'),
      buildProject(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('fileNotWritable');
    }
  });
});

describe('writeFileAtomic', () => {
  it('replaces the content of an existing file', async () => {
    const filePath = join(directory, 'file.txt');
    await writeFileAtomic(filePath, 'first');
    await writeFileAtomic(filePath, 'second');
    expect(await readFile(filePath, 'utf8')).toBe('second');
  });
});
