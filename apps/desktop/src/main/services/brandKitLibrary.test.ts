import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyBrandKitToProject,
  BRAND_KIT_LIBRARY_FORMAT,
  createDefaultBrandKit,
  getProjectLogoData,
  type BrandKitLogoData,
} from '@koma-motion/brand-kit';
import { createSeededIdGenerator, komaProjectSchema } from '@koma-motion/core';
import { buildBrandKit, buildProject } from '@koma-motion/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IpcResponse } from '../../shared/ipc';
import {
  createBrandKitLibrary,
  LIBRARY_FILE_NAME,
  LOGO_DIRECTORY_NAME,
  type BrandKitLibrary,
} from './brandKitLibrary';

const ONE_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const ONE_PIXEL_SHA256 = createHash('sha256')
  .update(Buffer.from(ONE_PIXEL, 'base64'))
  .digest('hex');
const logo: BrandKitLogoData = { name: 'acme.png', mediaType: 'image/png', data: ONE_PIXEL };

type State = IpcResponse<'koma:brand-kits:list'>;

function ready(state: State): Extract<State, { status: 'ready' }> {
  if (state.status !== 'ready') {
    throw new Error(`Expected a ready library, got ${JSON.stringify(state)}`);
  }
  return state;
}

/** The sentence a result shows to the user, for assertions. */
function messageOf(result: object): string {
  if ('message' in result && typeof result.message === 'string') {
    return result.message;
  }
  if ('logoProblem' in result && typeof result.logoProblem === 'string') {
    return result.logoProblem;
  }
  return '';
}

let directory: string;
let libraryDirectory: string;

function open(): BrandKitLibrary {
  let tick = 0;
  return createBrandKitLibrary(libraryDirectory, {
    now: () => new Date(Date.UTC(2026, 8, 30, 12, 0, tick++)),
    idGenerator: createSeededIdGenerator(`library-${String(Math.random())}`),
  });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'koma-brand-kits-'));
  libraryDirectory = join(directory, 'user-data', 'brand-kits');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true, maxRetries: 5 });
});

describe('Brand Kit library', () => {
  it('starts empty when nothing is stored and creates no files by reading', async () => {
    const state = ready(await open().list());
    expect(state).toEqual({ status: 'ready', kits: [], unreadableCount: 0, kitId: null });
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it('creates, renames, duplicates and deletes kits', async () => {
    const library = open();
    const brandKit = buildBrandKit({ name: 'Acme', logoAssetId: 'asset_in_project' });

    const created = ready(await library.create({ name: '  Acme  ', brandKit, logo: null }));
    expect(created.kits).toHaveLength(1);
    const [kit] = created.kits;
    expect(created.kitId).toBe(kit?.id);
    expect(kit?.name).toBe('Acme');
    // A project asset id means nothing outside the project.
    expect(kit?.brandKit.logoAssetId).toBeNull();
    const id = kit?.id ?? '';

    const blank = ready(
      await library.create({ name: 'Blank', brandKit: createDefaultBrandKit(), logo: null }),
    );
    expect(blank.kits.map((item) => item.name)).toEqual(['Blank', 'Acme']);

    const renamed = ready(await library.rename(id, 'Acme dark'));
    expect(renamed.kits.find((item) => item.id === id)?.name).toBe('Acme dark');

    const duplicated = ready(await library.duplicate(id));
    expect(duplicated.kits.map((item) => item.name)).toEqual([
      'Blank',
      'Acme dark',
      'Acme dark copy',
    ]);
    expect(duplicated.kitId).not.toBe(id);

    const deleted = ready(await library.remove(id));
    expect(deleted.kits.map((item) => item.name)).toEqual(['Blank', 'Acme dark copy']);
    expect(deleted.kitId).toBeNull();

    await expect(library.rename(id, 'Gone')).resolves.toEqual({
      status: 'failed',
      message: 'This saved Brand Kit no longer exists.',
    });
  });

  it('keeps kits for another session, as another project would see them', async () => {
    const created = ready(
      await open().create({ name: 'Acme', brandKit: buildBrandKit({ name: 'Acme' }), logo }),
    );
    const later = ready(await open().list());
    expect(later.kits).toEqual(created.kits);
  });

  it('copies the logo into the library and applies it to a different project', async () => {
    const source = buildProject({
      name: 'Source',
      brandKit: buildBrandKit({ name: 'Acme', logoAssetId: 'asset_source_logo' }),
      assets: [
        {
          id: 'asset_source_logo',
          type: 'image',
          name: 'acme.png',
          mediaType: 'image/png',
          projectPath: 'assets/asset_source_logo.png',
          metadata: {},
          embeddedData: { encoding: 'base64', data: ONE_PIXEL },
        },
      ],
    });
    const projectLogo = getProjectLogoData(source);
    const created = ready(
      await open().create({ name: 'Acme', brandKit: source.brandKit, logo: projectLogo }),
    );
    const id = created.kits[0]?.id ?? '';
    expect(created.kits[0]?.logo).toEqual({
      name: 'acme.png',
      mediaType: 'image/png',
      sha256: ONE_PIXEL_SHA256,
      byteLength: 70,
      available: true,
    });

    // The library holds its own copy, named by content, and no path of any kind.
    const stored = await readFile(join(libraryDirectory, LIBRARY_FILE_NAME), 'utf8');
    expect(stored).not.toContain(directory);
    expect(stored).not.toContain(JSON.stringify(directory).slice(1, -1));
    expect(stored).not.toContain(ONE_PIXEL);
    await expect(readdir(join(libraryDirectory, LOGO_DIRECTORY_NAME))).resolves.toEqual([
      `${ONE_PIXEL_SHA256}.png`,
    ]);

    // The source project is gone; a new session applies the kit to another project.
    const loaded = await open().load(id);
    expect(loaded).toMatchObject({ status: 'loaded', logo, logoProblem: null });
    if (loaded.status !== 'loaded') {
      return;
    }
    const target = buildProject({ name: 'Target', brandKit: buildBrandKit({ name: 'Other' }) });
    const applied = applyBrandKitToProject(
      target,
      loaded.kit.brandKit,
      loaded.logo,
      createSeededIdGenerator('target'),
    );
    expect(komaProjectSchema.safeParse(applied).success).toBe(true);
    expect(applied.brandKit.name).toBe('Acme');
    expect(getProjectLogoData(applied)).toEqual(logo);
  });

  it('shares one logo file between copies and removes it with the last kit', async () => {
    const library = open();
    const created = ready(await library.create({ name: 'Acme', brandKit: buildBrandKit(), logo }));
    const id = created.kits[0]?.id ?? '';
    const copy = ready(await library.duplicate(id)).kitId ?? '';
    const logos = join(libraryDirectory, LOGO_DIRECTORY_NAME);

    ready(await library.remove(id));
    await expect(readdir(logos)).resolves.toEqual([`${ONE_PIXEL_SHA256}.png`]);
    await expect(library.load(copy)).resolves.toMatchObject({ logo, logoProblem: null });

    ready(await library.remove(copy));
    await expect(readdir(logos)).resolves.toEqual([]);
  });

  it('updates a kit from project values, including removing its logo', async () => {
    const library = open();
    const id =
      ready(await library.create({ name: 'Acme', brandKit: buildBrandKit(), logo })).kitId ?? '';
    const updated = ready(
      await library.update(id, { brandKit: buildBrandKit({ tone: 'bold' }), logo: null }),
    );
    expect(updated.kits[0]).toMatchObject({ name: 'Acme', logo: null, brandKit: { tone: 'bold' } });
    await expect(readdir(join(libraryDirectory, LOGO_DIRECTORY_NAME))).resolves.toEqual([]);
  });

  it('refuses logo data that is not the image it claims to be', async () => {
    const library = open();
    const text = Buffer.from('not an image').toString('base64');
    const fake = await library.create({
      name: 'Fake',
      brandKit: buildBrandKit(),
      logo: { name: 'fake.png', mediaType: 'image/png', data: text },
    });
    expect(fake.status).toBe('failed');
    expect(messageOf(fake)).toContain('not a PNG');
    await expect(
      library.create({
        name: 'Wrong type',
        brandKit: buildBrandKit(),
        logo: { ...logo, mediaType: 'image/gif' },
      }),
    ).resolves.toMatchObject({ status: 'failed' });
    expect(ready(await library.list()).kits).toEqual([]);
  });

  it('reports a missing or altered logo file and applies the kit without it', async () => {
    const library = open();
    const id =
      ready(await library.create({ name: 'Acme', brandKit: buildBrandKit(), logo })).kitId ?? '';
    const logoPath = join(libraryDirectory, LOGO_DIRECTORY_NAME, `${ONE_PIXEL_SHA256}.png`);

    const altered = Buffer.from(ONE_PIXEL, 'base64');
    altered[altered.length - 1] = 0;
    await writeFile(logoPath, altered);
    const damaged = await library.load(id);
    expect(damaged).toMatchObject({
      status: 'loaded',
      logo: null,
      kit: { logo: { available: false } },
    });
    expect(messageOf(damaged)).toContain('damaged');

    await rm(logoPath);
    expect(ready(await library.list()).kits[0]?.logo?.available).toBe(false);
    const missing = await library.load(id);
    expect(missing).toMatchObject({ status: 'loaded', logo: null });
    expect(messageOf(missing)).toContain('missing');
  });

  it('never overwrites a damaged library and moves it aside only on request', async () => {
    await mkdir(libraryDirectory, { recursive: true });
    const libraryPath = join(libraryDirectory, LIBRARY_FILE_NAME);
    await writeFile(libraryPath, '{ "format": "koma-motion/brand-kit-library", "kits": [', 'utf8');
    const library = open();

    const listed = await library.list();
    expect(listed).toMatchObject({ status: 'damaged', canStartNew: true });
    expect(messageOf(listed)).toContain('not valid JSON');
    await expect(
      library.create({ name: 'Acme', brandKit: buildBrandKit(), logo: null }),
    ).resolves.toMatchObject({ status: 'failed' });
    await expect(readFile(libraryPath, 'utf8')).resolves.toContain('"kits": [');

    const started = await library.startNew();
    expect(started.status).toBe('started');
    if (started.status !== 'started') {
      return;
    }
    expect(started.backupFileName).toMatch(/^library\.unreadable-\d{8}T\d{6}-[0-9a-f]{6}\.json$/);
    await expect(
      readFile(join(libraryDirectory, started.backupFileName), 'utf8'),
    ).resolves.toContain('"kits": [');
    expect(ready(await library.list()).kits).toEqual([]);
    await expect(library.startNew()).resolves.toMatchObject({ status: 'failed' });
  });

  it('leaves a library from a newer version alone', async () => {
    await mkdir(libraryDirectory, { recursive: true });
    const text = JSON.stringify({ format: BRAND_KIT_LIBRARY_FORMAT, version: 99, kits: [] });
    await writeFile(join(libraryDirectory, LIBRARY_FILE_NAME), text, 'utf8');
    const library = open();
    const listed = await library.list();
    expect(listed).toMatchObject({ status: 'damaged', canStartNew: false });
    expect(messageOf(listed)).toContain('newer version');
    await expect(library.startNew()).resolves.toMatchObject({ status: 'failed' });
    await expect(readFile(join(libraryDirectory, LIBRARY_FILE_NAME), 'utf8')).resolves.toBe(text);
  });

  it('keeps unreadable entries and their logos through later changes', async () => {
    const library = open();
    ready(await library.create({ name: 'Acme', brandKit: buildBrandKit(), logo }));
    const libraryPath = join(libraryDirectory, LIBRARY_FILE_NAME);
    const document = JSON.parse(await readFile(libraryPath, 'utf8')) as {
      kits: Array<Record<string, unknown>>;
    };
    const [first] = document.kits;
    const broken = { ...first, id: 'kit_broken', brandKit: 'damaged by hand' };
    document.kits.push(broken);
    await writeFile(libraryPath, JSON.stringify(document), 'utf8');

    const listed = ready(await library.list());
    expect(listed.unreadableCount).toBe(1);
    const id = listed.kits[0]?.id ?? '';
    ready(await library.remove(id));

    const after = JSON.parse(await readFile(libraryPath, 'utf8')) as { kits: unknown[] };
    expect(after.kits).toEqual([broken]);
    // The unreadable entry still names the logo, so the file is kept for it.
    await expect(readdir(join(libraryDirectory, LOGO_DIRECTORY_NAME))).resolves.toEqual([
      `${ONE_PIXEL_SHA256}.png`,
    ]);
  });

  it('reports a failed write and keeps the previous library', async () => {
    const library = open();
    ready(await library.create({ name: 'Acme', brandKit: buildBrandKit(), logo: null }));
    const libraryPath = join(libraryDirectory, LIBRARY_FILE_NAME);
    const before = await readFile(libraryPath, 'utf8');
    // A folder where the logo folder should be makes every logo write fail.
    await writeFile(join(libraryDirectory, LOGO_DIRECTORY_NAME), 'in the way', 'utf8');

    const failed = await library.create({ name: 'With logo', brandKit: buildBrandKit(), logo });
    expect(failed.status).toBe('failed');
    expect(messageOf(failed)).toContain('were not changed');
    await expect(readFile(libraryPath, 'utf8')).resolves.toBe(before);
  });

  it('runs actions one after another so none is lost', async () => {
    const library = open();
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        library.create({ name: `Kit ${String(index)}`, brandKit: buildBrandKit(), logo: null }),
      ),
    );
    expect(ready(await library.list()).kits).toHaveLength(5);
  });
});
