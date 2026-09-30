import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultBrandKit } from '@koma-motion/brand-kit';
import type * as ProjectFiles from '@koma-motion/project-format/node';
import { expect, it, vi } from 'vitest';
import { createBrandKitLibrary } from './brandKitLibrary';

const fail = vi.hoisted(() => ({ once: true }));
vi.mock('@koma-motion/project-format/node', async (importOriginal) => {
  const actual = await importOriginal<typeof ProjectFiles>();
  return {
    ...actual,
    writeFileAtomic: (...args: Parameters<typeof actual.writeFileAtomic>) => {
      if (fail.once) {
        fail.once = false;
        return Promise.reject(Object.assign(new Error('Disk full'), { code: 'ENOSPC' }));
      }
      return actual.writeFileAtomic(...args);
    },
  };
});

it('collects a newly stored logo after failed library persistence and can retry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deck-library-failure-'));
  try {
    const library = createBrandKitLibrary(directory);
    const input = {
      name: 'Reviewed deck kit',
      brandKit: createDefaultBrandKit(),
      logo: {
        name: 'validated.png',
        mediaType: 'image/png' as const,
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      },
    };
    expect(await library.create(input)).toMatchObject({ status: 'failed' });
    expect(await readdir(join(directory, 'logos'))).toEqual([]);
    expect(await library.list()).toMatchObject({ kits: [] });
    expect(await library.create(input)).toMatchObject({
      status: 'ready',
      kits: [{ name: 'Reviewed deck kit' }],
    });
    expect(await readdir(join(directory, 'logos'))).toHaveLength(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
