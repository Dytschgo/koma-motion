import { execFile, spawn } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  komaProjectSchema,
  MAX_EMBEDDED_ASSET_BYTES,
  MAX_EMBEDDED_ASSET_CHARACTERS,
  MAX_PROJECT_FILE_BYTES,
  type KomaProject,
} from '@koma-motion/core';
import { buildProject } from '@koma-motion/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readProjectFile, writeFileAtomic, writeProjectFile } from './files';
import { withProjectFileOperation } from './operationGate';

const execFileAsync = promisify(execFile);

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'koma-format-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('project files', () => {
  it('refuses a stale save and preserves the file changed by another writer', async () => {
    const filePath = join(directory, 'shared.koma');
    await writeProjectFile(filePath, buildProject({ name: 'Original' }));
    const loaded = await readProjectFile(filePath);
    if (!loaded.ok) throw new Error('Expected the original project to load');
    await writeProjectFile(filePath, buildProject({ name: 'External edit' }));
    const external = await readFile(filePath);

    const saved = await writeProjectFile(filePath, buildProject({ name: 'Stale edit' }), {
      expectedRevision: loaded.value.fileRevision,
    });

    expect(saved).toMatchObject({ ok: false, error: { code: 'fileChangedExternally' } });
    expect(await readFile(filePath)).toEqual(external);
    expect(await readdir(directory)).toEqual(['shared.koma']);
  });

  it('refuses to recreate a file removed after it was opened', async () => {
    const filePath = join(directory, 'removed.koma');
    const first = await writeProjectFile(filePath, buildProject());
    if (!first.ok) throw new Error('Expected the initial save to succeed');
    await rm(filePath);

    const saved = await writeProjectFile(filePath, buildProject(), {
      expectedRevision: first.value.fileRevision,
    });

    expect(saved).toMatchObject({ ok: false, error: { code: 'fileChangedExternally' } });
    expect(await readdir(directory)).toEqual([]);
  });

  it('advances the revision after a save so consecutive saves remain possible', async () => {
    const filePath = join(directory, 'story.koma');
    const first = await writeProjectFile(filePath, buildProject());
    if (!first.ok) throw new Error('Expected the initial save to succeed');
    const second = await writeProjectFile(filePath, buildProject({ name: 'Second' }), {
      expectedRevision: first.value.fileRevision,
    });
    if (!second.ok) throw new Error('Expected the second save to succeed');
    expect(second.value.fileRevision).not.toBe(first.value.fileRevision);
    const loaded = await readProjectFile(filePath);
    expect(loaded).toMatchObject({ ok: true, value: { fileRevision: second.value.fileRevision } });
    const third = await writeProjectFile(filePath, buildProject({ name: 'Third' }), {
      expectedRevision: second.value.fileRevision,
    });
    expect(third.ok).toBe(true);
  });

  it('detects byte changes even when the parsed document is unchanged', async () => {
    const filePath = join(directory, 'reformatted.koma');
    const first = await writeProjectFile(filePath, buildProject());
    if (!first.ok) throw new Error('Expected the initial save to succeed');
    await writeFile(filePath, JSON.stringify(buildProject()));
    const changed = await readFile(filePath);
    const saved = await writeProjectFile(filePath, buildProject(), {
      expectedRevision: first.value.fileRevision,
    });
    expect(saved).toMatchObject({ ok: false, error: { code: 'fileChangedExternally' } });
    expect(await readFile(filePath)).toEqual(changed);
  });

  it('cleans the staged write when the final replacement check rejects it', async () => {
    const filePath = join(directory, 'story.koma');
    await writeFile(filePath, 'Original');
    await expect(
      writeFileAtomic(filePath, 'Local edit', async () => {
        await writeFile(filePath, 'External edit');
        throw new Error('Replacement rejected');
      }),
    ).rejects.toThrow('Replacement rejected');
    expect(await readFile(filePath, 'utf8')).toBe('External edit');
    expect(await readdir(directory)).toEqual(['story.koma']);
  });

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

describe('project size limits', () => {
  it('saves and reopens one maximum-size asset', async () => {
    const filePath = join(directory, 'asset.koma');
    const project = buildProject({ assets: [maximumAsset('asset-1', maximumAssetData())] });
    const saved = await writeProjectFile(filePath, project);
    expect(saved.ok).toBe(true);
    const opened = await readProjectFile(filePath);
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.value.project.assets).toHaveLength(1);
      expect(opened.value.project.assets[0]?.embeddedData?.data.length).toBe(
        MAX_EMBEDDED_ASSET_CHARACTERS,
      );
    }
  }, 30_000);

  it('does not save assets that are allowed individually but too large together', async () => {
    const data = maximumAssetData();
    const project = buildProject({
      assets: Array.from({ length: 25 }, (_, index) =>
        maximumAsset(`asset-${String(index)}`, data),
      ),
    });
    expect(komaProjectSchema.safeParse(project).success).toBe(false);

    const filePath = join(directory, 'assets.koma');
    const saved = await writeProjectFile(filePath, project);
    expect(saved.ok).toBe(false);
    if (!saved.ok) {
      expect(saved.error.code).toBe('tooLarge');
    }
    expect(await readdir(directory)).toEqual([]);
  }, 30_000);

  it('does not save multibyte text whose UTF-8 form exceeds the byte limit', async () => {
    const note = 'あ'.repeat(Math.floor(MAX_PROJECT_FILE_BYTES / 3) + 1);
    expect(note.length).toBeLessThanOrEqual(MAX_PROJECT_FILE_BYTES);
    const project = { ...buildProject(), note };
    expect(komaProjectSchema.safeParse(project).success).toBe(false);

    const filePath = join(directory, 'multibyte.koma');
    const saved = await writeProjectFile(filePath, project);
    expect(saved.ok).toBe(false);
    if (!saved.ok) {
      expect(saved.error.code).toBe('tooLarge');
    }
    expect(await readdir(directory)).toEqual([]);
  }, 30_000);

  it('saves and reopens extension data within the limits', async () => {
    const filePath = join(directory, 'extension.koma');
    const project = {
      ...buildProject(),
      futureFeature: { label: 'café', values: [1, null, true] },
    };
    const saved = await writeProjectFile(filePath, project);
    expect(saved.ok).toBe(true);
    const opened = await readProjectFile(filePath);
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.value.project['futureFeature']).toEqual({
        label: 'café',
        values: [1, null, true],
      });
    }
  });
});

describe('uninspectable save targets', () => {
  it('does not open or replace an oversized newer-format file', async () => {
    const filePath = join(directory, 'future.koma');
    const header = JSON.stringify({ ...buildProject(), schemaVersion: 99 });
    const handle = await open(filePath, 'w');
    await handle.writeFile(header, 'utf8');
    await handle.truncate(MAX_PROJECT_FILE_BYTES + 1);
    await handle.close();

    const opened = await readProjectFile(filePath);
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.error.code).toBe('tooLarge');
    }

    const saved = await writeProjectFile(filePath, buildProject());
    expect(saved.ok).toBe(false);
    if (!saved.ok) {
      expect(saved.error.code).toBe('uninspectableTarget');
    }

    const check = await open(filePath, 'r');
    const prefix = Buffer.alloc(Buffer.byteLength(header));
    await check.read(prefix, 0, prefix.length, 0);
    await check.close();
    expect(prefix.toString('utf8')).toBe(header);
    expect((await stat(filePath)).size).toBe(MAX_PROJECT_FILE_BYTES + 1);
    expect(await readdir(directory)).toEqual(['future.koma']);
  }, 30_000);

  it('does not replace a newer-format file that cannot be read', async () => {
    const filePath = join(directory, 'future.koma');
    const header = JSON.stringify({ ...buildProject(), schemaVersion: 99 });
    await writeFile(filePath, header, 'utf8');
    const restore = await denyRead(filePath);
    try {
      await expect(readFile(filePath, 'utf8')).rejects.toThrow();
      const saved = await writeProjectFile(filePath, buildProject());
      expect(saved.ok).toBe(false);
      if (!saved.ok) {
        expect(saved.error.code).toBe('uninspectableTarget');
      }
      expect(await readdir(directory)).toEqual(['future.koma']);
    } finally {
      await restore();
    }
    expect(await readFile(filePath, 'utf8')).toBe(header);
  });

  it('does not replace a folder', async () => {
    const folder = join(directory, 'project.koma');
    await mkdir(folder);
    const saved = await writeProjectFile(folder, buildProject());
    expect(saved.ok).toBe(false);
    if (!saved.ok) {
      expect(saved.error.code).toBe('uninspectableTarget');
    }
    expect((await stat(folder)).isDirectory()).toBe(true);
  });

  it.skipIf(process.platform !== 'win32')(
    'keeps the original file when a lock prevents replacement',
    async () => {
      const filePath = join(directory, 'locked.koma');
      await writeFile(filePath, 'original-content', 'utf8');
      const release = await lockFile(filePath, 'read');
      try {
        const saved = await writeProjectFile(filePath, buildProject());
        expect(saved.ok).toBe(false);
        if (!saved.ok) {
          expect(saved.error.code).toBe('fileNotWritable');
        }
        expect(await readdir(directory)).toEqual(['locked.koma']);
      } finally {
        await release();
      }
      expect(await readFile(filePath, 'utf8')).toBe('original-content');
    },
    LOCK_TEST_TIMEOUT_MS,
  );

  it.skipIf(process.platform !== 'win32')(
    'does not replace a newer-format file an exclusive lock hides',
    async () => {
      const filePath = join(directory, 'hidden.koma');
      const header = JSON.stringify({ ...buildProject(), schemaVersion: 99 });
      await writeFile(filePath, header, 'utf8');
      const release = await lockFile(filePath, 'none');
      try {
        const saved = await writeProjectFile(filePath, buildProject());
        expect(saved.ok).toBe(false);
        if (!saved.ok) {
          expect(saved.error.code).toBe('uninspectableTarget');
        }
        expect(await readdir(directory)).toEqual(['hidden.koma']);
      } finally {
        await release();
      }
      expect(await readFile(filePath, 'utf8')).toBe(header);
    },
    LOCK_TEST_TIMEOUT_MS,
  );
});

describe('project file operation limit', () => {
  it('does not start a second write while a project file operation is running', async () => {
    let releaseHold: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const holder = withProjectFileOperation(() => hold);
    const filePath = join(directory, 'queued.koma');
    let settled = false;
    const write = writeProjectFile(filePath, buildProject()).then((result) => {
      settled = true;
      return result;
    });

    try {
      const started = Date.now();
      while (!settled && Date.now() - started < 300) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(settled).toBe(false);
      expect(await readdir(directory)).toEqual([]);
    } finally {
      releaseHold();
      await holder;
    }
    await expect(write).resolves.toMatchObject({ ok: true });
    expect(await readdir(directory)).toEqual(['queued.koma']);
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

function maximumAssetData(): string {
  return 'A'.repeat(MAX_EMBEDDED_ASSET_CHARACTERS);
}

function maximumAsset(id: string, data: string): KomaProject['assets'][number] {
  return {
    id,
    type: 'image',
    name: `${id}.png`,
    mediaType: 'image/png',
    projectPath: `assets/${id}.png`,
    metadata: { byteLength: MAX_EMBEDDED_ASSET_BYTES },
    embeddedData: { encoding: 'base64', data },
  };
}

async function denyRead(filePath: string): Promise<() => Promise<void>> {
  if (process.platform === 'win32') {
    const user = process.env['USERNAME'];
    if (user === undefined || user === '') {
      throw new Error('USERNAME is required to deny read permission');
    }
    await execFileAsync('icacls', [filePath, '/deny', `${user}:(R)`]);
    return async () => {
      await execFileAsync('icacls', [filePath, '/remove:d', user]);
    };
  }
  await chmod(filePath, 0o000);
  return async () => {
    await chmod(filePath, 0o644);
  };
}

/** Starting PowerShell takes several seconds on a busy computer. */
const LOCK_START_TIMEOUT_MS = 20_000;
const LOCK_TEST_TIMEOUT_MS = 30_000;

function lockFile(filePath: string, share: 'none' | 'read'): Promise<() => Promise<void>> {
  const script = [
    '$path = $env:KOMA_LOCK_TARGET',
    "$share = if ($env:KOMA_LOCK_SHARE -eq 'read') { [System.IO.FileShare]::Read } else { [System.IO.FileShare]::None }",
    '$fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)',
    "Write-Output 'LOCKED'",
    '[Console]::Out.Flush()',
    'while ($true) { Start-Sleep -Seconds 1 }',
  ].join('; ');
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
    env: { ...process.env, KOMA_LOCK_TARGET: filePath, KOMA_LOCK_SHARE: share },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Timed out waiting for the file lock'));
    }, LOCK_START_TIMEOUT_MS);
    const outputStream = child.stdout;
    if (outputStream === null) {
      child.kill();
      reject(new Error('The lock process has no output'));
      return;
    }
    let output = '';
    outputStream.setEncoding('utf8');
    outputStream.on('data', (chunk: string) => {
      output += chunk;
      if (!settled && output.includes('LOCKED')) {
        settled = true;
        clearTimeout(timer);
        resolve(async () => {
          child.kill();
          await new Promise<void>((done) => {
            if (child.exitCode !== null) {
              done();
              return;
            }
            child.once('exit', () => done());
          });
        });
      }
    });
    child.once('exit', (code) => {
      if (!settled) {
        clearTimeout(timer);
        reject(new Error(`Lock process exited early (${String(code)})`));
      }
    });
  });
}
