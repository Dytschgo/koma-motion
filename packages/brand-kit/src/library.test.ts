import {
  createSeededIdGenerator,
  komaProjectSchema,
  MAX_PROJECT_ASSETS,
  type AssetReference,
  type ImageElement,
} from '@koma-motion/core';
import {
  buildBrandKit,
  buildKoma,
  buildPresentation,
  buildProject,
  buildShape,
} from '@koma-motion/core/testing';
import { describe, expect, it } from 'vitest';
import { applyBrandKitToProject, getProjectLogoData } from './apply';
import {
  BRAND_KIT_LIBRARY_FORMAT,
  copyName,
  findMatchingSavedKit,
  parseBrandKitLibrary,
  serialiseBrandKitLibrary,
  toLibraryBrandKit,
  type BrandKitLogoData,
  type SavedBrandKit,
} from './library';

const ONE_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const OTHER_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function savedKit(overrides: Partial<SavedBrandKit> = {}): SavedBrandKit {
  return {
    id: 'kit_acme',
    name: 'Acme',
    createdAt: '2026-09-30T10:00:00.000Z',
    updatedAt: '2026-09-30T10:00:00.000Z',
    brandKit: toLibraryBrandKit(buildBrandKit({ name: 'Acme' })),
    logo: null,
    ...overrides,
  };
}

function logoAsset(id: string, data = ONE_PIXEL): AssetReference {
  return {
    id,
    type: 'image',
    name: `${id}.png`,
    mediaType: 'image/png',
    projectPath: `assets/${id}.png`,
    metadata: {},
    embeddedData: { encoding: 'base64', data },
  };
}

const logo: BrandKitLogoData = { name: 'acme.png', mediaType: 'image/png', data: ONE_PIXEL };

describe('parseBrandKitLibrary', () => {
  it('round-trips a library', () => {
    const kits = [
      savedKit(),
      savedKit({
        id: 'kit_two',
        name: 'Two',
        logo: { name: 'two.png', mediaType: 'image/png', sha256: 'a'.repeat(64), byteLength: 70 },
      }),
    ];
    const text = serialiseBrandKitLibrary(kits);
    expect(parseBrandKitLibrary(text)).toEqual({ status: 'ready', kits, unreadable: [] });
    expect(serialiseBrandKitLibrary(kits)).toBe(text);
  });

  it('round-trips instructions and file provenance, and treats bad ones as unreadable', () => {
    const profile = savedKit({
      instructions: 'Use short headlines.',
      referenceProvenance: {
        analyzedAt: '2026-10-02T10:00:00.000Z',
        provider: 'claude-code',
        model: 'opus',
        files: [{ fileName: 'logo.png', kind: 'image', analyzed: 1, total: 1 }],
      },
    });
    const parsed = parseBrandKitLibrary(serialiseBrandKitLibrary([profile]));
    expect(parsed).toMatchObject({ status: 'ready', kits: [profile], unreadable: [] });
    for (const broken of [
      { ...profile, instructions: 'x'.repeat(8001) },
      {
        ...profile,
        referenceProvenance: {
          ...profile.referenceProvenance,
          files: [{ fileName: 'private/logo.png', kind: 'image', analyzed: 1, total: 1 }],
        },
      },
    ]) {
      const text = JSON.stringify({ format: BRAND_KIT_LIBRARY_FORMAT, version: 1, kits: [broken] });
      expect(parseBrandKitLibrary(text)).toMatchObject({ kits: [], unreadable: [broken] });
    }
  });

  it('reports a file that is not JSON or not a library without throwing', () => {
    expect(parseBrandKitLibrary('{ not json')).toMatchObject({ status: 'damaged' });
    expect(parseBrandKitLibrary('[]')).toMatchObject({ status: 'damaged' });
    expect(
      parseBrandKitLibrary(JSON.stringify({ format: 'other', version: 1, kits: [] })),
    ).toMatchObject({ status: 'damaged' });
  });

  it('refuses a library written by a newer version', () => {
    const text = JSON.stringify({ format: BRAND_KIT_LIBRARY_FORMAT, version: 2, kits: [] });
    expect(parseBrandKitLibrary(text)).toEqual({ status: 'newer', version: 2 });
  });

  it('keeps unreadable entries and writes them back unchanged', () => {
    const broken = { id: 'kit_broken', name: 'Broken', brandKit: { colours: 'red' } };
    const duplicate = savedKit({ name: 'Same id' });
    const text = JSON.stringify({
      format: BRAND_KIT_LIBRARY_FORMAT,
      version: 1,
      kits: [savedKit(), broken, duplicate],
    });
    const parsed = parseBrandKitLibrary(text);
    expect(parsed.status).toBe('ready');
    if (parsed.status !== 'ready') {
      return;
    }
    expect(parsed.kits.map((kit) => kit.name)).toEqual(['Acme']);
    expect(parsed.unreadable).toEqual([broken, duplicate]);

    const rewritten = parseBrandKitLibrary(
      serialiseBrandKitLibrary(parsed.kits, parsed.unreadable),
    );
    expect(rewritten).toEqual(parsed);
  });

  it('rejects host paths and logo references that are not content hashes', () => {
    const withPath = {
      ...savedKit(),
      logo: {
        name: 'logo.png',
        mediaType: 'image/png',
        sha256: 'C:\\Users\\someone\\logo.png',
        byteLength: 10,
      },
    };
    const withAssetId = { ...savedKit(), brandKit: { ...savedKit().brandKit, logoAssetId: 'a1' } };
    const parsed = parseBrandKitLibrary(
      JSON.stringify({
        format: BRAND_KIT_LIBRARY_FORMAT,
        version: 1,
        kits: [withPath, withAssetId],
      }),
    );
    expect(parsed).toMatchObject({ status: 'ready', kits: [] });
    expect(parsed.status === 'ready' && parsed.unreadable).toHaveLength(2);
  });
});

describe('copyName', () => {
  it('finds a free name', () => {
    expect(copyName('Acme', ['Acme'])).toBe('Acme copy');
    expect(copyName('Acme', ['Acme', 'Acme copy', 'Acme copy 2'])).toBe('Acme copy 3');
    expect(copyName('x'.repeat(120), []).length).toBeLessThanOrEqual(120);
  });
});

describe('findMatchingSavedKit', () => {
  it('matches settings and logo bytes, not the project asset id', () => {
    const brandKit = buildBrandKit({ name: 'Acme', logoAssetId: 'asset_project' });
    const kit = savedKit({
      logo: { name: 'a.png', mediaType: 'image/png', sha256: 'b'.repeat(64), byteLength: 70 },
    });
    expect(findMatchingSavedKit([kit], brandKit, 'b'.repeat(64))).toBe(kit);
    expect(findMatchingSavedKit([kit], brandKit, null)).toBeUndefined();
    expect(
      findMatchingSavedKit([kit], { ...brandKit, tone: 'different' }, 'b'.repeat(64)),
    ).toBeUndefined();
  });
});

describe('applyBrandKitToProject', () => {
  const ids = (): ReturnType<typeof createSeededIdGenerator> => createSeededIdGenerator('apply');

  it('adds the logo as a new asset and removes the previous unused logo', () => {
    const project = buildProject({
      brandKit: buildBrandKit({ name: 'Old', logoAssetId: 'asset_old' }),
      assets: [logoAsset('asset_old', OTHER_PIXEL)],
    });
    const kit = toLibraryBrandKit(buildBrandKit({ name: 'Acme', tone: 'calm' }));
    const applied = applyBrandKitToProject(project, kit, logo, ids());

    expect(applied.brandKit.name).toBe('Acme');
    expect(applied.brandKit.tone).toBe('calm');
    expect(applied.assets).toHaveLength(1);
    const [asset] = applied.assets;
    expect(asset?.id).toBe(applied.brandKit.logoAssetId);
    expect(asset).toMatchObject({
      name: 'acme.png',
      mediaType: 'image/png',
      embeddedData: { data: ONE_PIXEL },
      metadata: { byteLength: 70 },
    });
    expect(asset?.projectPath).toBe(`assets/${String(asset?.id)}.png`);
    expect(komaProjectSchema.safeParse(applied).success).toBe(true);
    expect(getProjectLogoData(applied)).toEqual({
      name: 'acme.png',
      mediaType: 'image/png',
      data: ONE_PIXEL,
    });
  });

  it('reuses an asset with the same bytes instead of adding a duplicate', () => {
    const image: ImageElement = {
      ...buildShape(),
      type: 'image',
      content: { assetId: 'asset_canvas', altText: 'Logo on a Koma' },
      style: { fit: 'contain', cornerRadius: 0 },
    };
    const project = buildProject({
      brandKit: buildBrandKit({ logoAssetId: null }),
      assets: [logoAsset('asset_canvas')],
      presentation: buildPresentation({ komas: [buildKoma({ elements: [image] })] }),
    });
    const applied = applyBrandKitToProject(
      project,
      toLibraryBrandKit(buildBrandKit({ name: 'Acme' })),
      logo,
      ids(),
    );
    expect(applied.assets.map((asset) => asset.id)).toEqual(['asset_canvas']);
    expect(applied.brandKit.logoAssetId).toBe('asset_canvas');
    expect(komaProjectSchema.safeParse(applied).success).toBe(true);
  });

  it('keeps a previous logo that an image on a Koma still uses', () => {
    const image: ImageElement = {
      ...buildShape(),
      type: 'image',
      content: { assetId: 'asset_old', altText: 'Old logo' },
      style: { fit: 'contain', cornerRadius: 0 },
    };
    const project = buildProject({
      brandKit: buildBrandKit({ logoAssetId: 'asset_old' }),
      assets: [logoAsset('asset_old', OTHER_PIXEL)],
      presentation: buildPresentation({ komas: [buildKoma({ elements: [image] })] }),
    });
    const applied = applyBrandKitToProject(
      project,
      toLibraryBrandKit(buildBrandKit()),
      null,
      ids(),
    );
    expect(applied.brandKit.logoAssetId).toBeNull();
    expect(applied.assets.map((asset) => asset.id)).toEqual(['asset_old']);
  });

  it('returns the same project when nothing changes', () => {
    const project = buildProject({
      brandKit: buildBrandKit({ name: 'Acme', logoAssetId: 'asset_logo' }),
      assets: [logoAsset('asset_logo')],
    });
    const kit = toLibraryBrandKit(project.brandKit);
    expect(applyBrandKitToProject(project, kit, logo, ids())).toBe(project);
    expect(applyBrandKitToProject(project, kit, null, ids())).not.toBe(project);
  });

  it('reports the asset limit instead of exceeding it', () => {
    const project = buildProject({
      assets: Array.from({ length: MAX_PROJECT_ASSETS }, (_, index) =>
        logoAsset(`asset_${String(index)}`, OTHER_PIXEL),
      ),
    });
    expect(() =>
      applyBrandKitToProject(project, toLibraryBrandKit(buildBrandKit()), logo, ids()),
    ).toThrow(`${String(MAX_PROJECT_ASSETS)} images`);
  });
});
