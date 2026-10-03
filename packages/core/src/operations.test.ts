import { describe, expect, it } from 'vitest';
import { createRandomIdGenerator, createSeededIdGenerator, hashString, idSchema } from './ids';
import {
  clearBrandLogo,
  duplicateKoma,
  insertKoma,
  moveKoma,
  removeKoma,
  replaceElement,
  setBrandLogo,
} from './operations';
import type { AssetReference } from './schema/asset';
import type { ImageElement } from './schema/element';
import { presentationSchema } from './schema/presentation';
import { komaProjectSchema, MAX_PROJECT_ASSETS } from './schema/project';
import { buildKoma, buildPresentation, buildProject, buildShape } from './testing/fixtures';

function imageAsset(id: string): AssetReference {
  return {
    id,
    type: 'image',
    name: `${id}.png`,
    mediaType: 'image/png',
    projectPath: `assets/${id}.png`,
    metadata: {},
    embeddedData: { encoding: 'base64', data: 'aGVsbG8=' },
  };
}

function imageElement(assetId: string): ImageElement {
  return {
    ...buildShape(),
    id: `element-${assetId}`,
    persistentId: `image-${assetId}`,
    name: 'Logo image',
    type: 'image',
    content: { assetId, altText: 'Logo' },
    style: { fit: 'contain', cornerRadius: 0 },
  };
}

describe('id generators', () => {
  it('creates valid random identifiers that differ', () => {
    const generator = createRandomIdGenerator();
    const first = generator.next('koma');
    const second = generator.next('koma');
    expect(first).not.toBe(second);
    expect(idSchema.safeParse(first).success).toBe(true);
  });

  it('creates the same identifiers for the same seed', () => {
    const a = createSeededIdGenerator('seed');
    const b = createSeededIdGenerator('seed');
    expect([a.next('koma', 'intro'), a.next('element'), a.next('element')]).toEqual([
      b.next('koma', 'intro'),
      b.next('element'),
      b.next('element'),
    ]);
  });

  it('creates different identifiers for different seeds and repeated keys', () => {
    const a = createSeededIdGenerator('seed-a');
    const b = createSeededIdGenerator('seed-b');
    expect(a.next('koma', 'intro')).not.toBe(b.next('koma', 'intro'));
    expect(a.next('koma', 'intro')).not.toBe(a.next('koma', 'intro'));
  });

  it('hashes to sixteen hex characters', () => {
    expect(hashString('koma')).toMatch(/^[0-9a-f]{16}$/);
    expect(hashString('koma')).toBe(hashString('koma'));
    expect(hashString('koma')).not.toBe(hashString('komb'));
  });
});

describe('document operations', () => {
  it('duplicates a Koma with new ids and the same persistent ids', () => {
    const source = buildKoma({ holdDurationMs: 4500 });
    const copy = duplicateKoma(source, createSeededIdGenerator('copy'), 'Next state');
    expect(copy.id).not.toBe(source.id);
    expect(copy.holdDurationMs).toBe(4500);
    expect(copy.elements.map((element) => element.persistentId)).toEqual(
      source.elements.map((element) => element.persistentId),
    );
    for (const [index, element] of copy.elements.entries()) {
      expect(element.id).not.toBe(source.elements[index]?.id);
    }
  });

  it('inserts a Koma after the given Koma', () => {
    const presentation = buildPresentation({
      komas: [buildKoma({ id: 'a' }), buildKoma({ id: 'c' })],
    });
    const result = insertKoma(presentation, buildKoma({ id: 'b' }), 'a');
    expect(result.komas.map((koma) => koma.id)).toEqual(['a', 'b', 'c']);
    expect(presentationSchema.safeParse(result).success).toBe(true);
  });

  it('inserts beyond the former 200-Koma maximum', () => {
    const presentation = buildPresentation({
      komas: Array.from({ length: 200 }, (_, index) =>
        buildKoma({ id: `koma-${String(index + 1)}`, elements: [] }),
      ),
    });
    expect(presentationSchema.safeParse(presentation).success).toBe(true);
    const inserted = insertKoma(presentation, buildKoma({ id: 'extra' }), 'koma-1');
    expect(inserted.komas).toHaveLength(201);
    expect(presentationSchema.safeParse(inserted).success).toBe(true);
  });

  it('removes a Koma together with its transitions', () => {
    const presentation = buildPresentation({
      komas: [buildKoma({ id: 'a' }), buildKoma({ id: 'b' })],
      transitions: [
        {
          id: 't',
          fromKomaId: 'a',
          toKomaId: 'b',
          strategy: 'continuous',
          duration: 900,
          easing: 'linear',
          elementTransitions: [],
          rationale: '',
        },
      ],
    });
    const result = removeKoma(presentation, 'b');
    expect(result.komas.map((koma) => koma.id)).toEqual(['a']);
    expect(result.transitions).toEqual([]);
  });

  it('moves a Koma and clamps at the ends', () => {
    const presentation = buildPresentation({
      komas: [buildKoma({ id: 'a' }), buildKoma({ id: 'b' }), buildKoma({ id: 'c' })],
    });
    expect(moveKoma(presentation, 'c', -1).komas.map((koma) => koma.id)).toEqual(['a', 'c', 'b']);
    expect(moveKoma(presentation, 'a', -1)).toBe(presentation);
    expect(moveKoma(presentation, 'a', 5).komas.map((koma) => koma.id)).toEqual(['b', 'c', 'a']);
  });

  it('replaces an element without touching the original document', () => {
    const presentation = buildPresentation();
    const moved = buildShape({ position: { x: 500, y: 500 } });
    const result = replaceElement(presentation, 'koma-1', moved);
    expect(result.komas[0]?.elements[0]?.position).toEqual({ x: 500, y: 500 });
    expect(presentation.komas[0]?.elements[0]?.position).toEqual({ x: 100, y: 100 });
  });
});

describe('Brand Kit logo assets', () => {
  const oldLogo = imageAsset('asset-old-logo');
  const newLogo = imageAsset('asset-new-logo');
  const fullAssets = [
    oldLogo,
    ...Array.from({ length: MAX_PROJECT_ASSETS - 1 }, (_, index) => imageAsset(`asset-${index}`)),
  ];

  it('keeps an old logo used by an image when the logo is replaced', () => {
    const project = buildProject({
      brandKit: { ...buildProject().brandKit, logoAssetId: oldLogo.id },
      assets: [oldLogo],
      presentation: buildPresentation({
        komas: [buildKoma({ elements: [imageElement(oldLogo.id)] })],
      }),
    });

    const updated = setBrandLogo(project, newLogo);

    expect(updated.brandKit.logoAssetId).toBe(newLogo.id);
    expect(updated.assets).toEqual([oldLogo, newLogo]);
    expect(komaProjectSchema.safeParse(updated).success).toBe(true);
    expect(project.assets).toEqual([oldLogo]);
  });

  it('keeps an old logo used by a group child when the logo is cleared', () => {
    const project = buildProject({
      brandKit: { ...buildProject().brandKit, logoAssetId: oldLogo.id },
      assets: [oldLogo],
      presentation: buildPresentation({
        komas: [
          buildKoma({
            elements: [
              {
                ...buildShape(),
                type: 'group',
                content: {
                  referenceSize: { width: 200, height: 200 },
                  children: [imageElement(oldLogo.id)],
                },
                style: {},
              },
            ],
          }),
        ],
      }),
    });

    const updated = clearBrandLogo(project);

    expect(updated.brandKit.logoAssetId).toBeNull();
    expect(updated.assets).toEqual([oldLogo]);
    expect(komaProjectSchema.safeParse(updated).success).toBe(true);
  });

  it('removes the previous logo when no image uses it', () => {
    const project = buildProject({
      brandKit: { ...buildProject().brandKit, logoAssetId: oldLogo.id },
      assets: [oldLogo],
    });

    expect(setBrandLogo(project, newLogo).assets).toEqual([newLogo]);
    expect(clearBrandLogo(project).assets).toEqual([]);
  });

  it('replaces an asset with the same id without duplicating it', () => {
    const project = buildProject({
      brandKit: { ...buildProject().brandKit, logoAssetId: oldLogo.id },
      assets: [oldLogo, newLogo],
    });
    const replacement = { ...newLogo, name: 'updated.png' };

    const updated = setBrandLogo(project, replacement);

    expect(updated.assets).toEqual([replacement]);
    expect(komaProjectSchema.safeParse(updated).success).toBe(true);
  });

  it('reuses the current logo id without keeping a stale copy', () => {
    const project = buildProject({
      brandKit: { ...buildProject().brandKit, logoAssetId: oldLogo.id },
      assets: [oldLogo],
      presentation: buildPresentation({
        komas: [buildKoma({ elements: [imageElement(oldLogo.id)] })],
      }),
    });
    const replacement = { ...oldLogo, name: 'replaced.png' };

    const updated = setBrandLogo(project, replacement);

    expect(updated.assets).toEqual([replacement]);
    expect(komaProjectSchema.safeParse(updated).success).toBe(true);
  });

  it('refuses a new logo at the asset limit when an image still needs the old one', () => {
    const project = buildProject({
      brandKit: { ...buildProject().brandKit, logoAssetId: oldLogo.id },
      assets: fullAssets,
      presentation: buildPresentation({
        komas: [buildKoma({ elements: [imageElement(oldLogo.id)] })],
      }),
    });

    expect(komaProjectSchema.safeParse(project).success).toBe(true);
    expect(() => setBrandLogo(project, newLogo)).toThrow(
      `A project can contain up to ${String(MAX_PROJECT_ASSETS)} images`,
    );
    expect(project.assets).toBe(fullAssets);
    expect(project.brandKit.logoAssetId).toBe(oldLogo.id);
  });

  it('updates the bytes of a referenced same-id asset at the limit without duplication', () => {
    const project = buildProject({
      brandKit: { ...buildProject().brandKit, logoAssetId: oldLogo.id },
      assets: fullAssets,
      presentation: buildPresentation({
        komas: [buildKoma({ elements: [imageElement(oldLogo.id)] })],
      }),
    });
    const replacement = {
      ...oldLogo,
      embeddedData: { encoding: 'base64' as const, data: 'bmV3' },
    };

    const updated = setBrandLogo(project, replacement);

    expect(updated.assets).toHaveLength(MAX_PROJECT_ASSETS);
    expect(updated.assets.filter((asset) => asset.id === oldLogo.id)).toEqual([replacement]);
    expect(updated.presentation).toBe(project.presentation);
    expect(komaProjectSchema.safeParse(updated).success).toBe(true);
  });

  it('allows an unused logo to be replaced at the asset limit', () => {
    const project = buildProject({
      brandKit: { ...buildProject().brandKit, logoAssetId: oldLogo.id },
      assets: fullAssets,
    });

    const updated = setBrandLogo(project, newLogo);

    expect(updated.assets).toHaveLength(MAX_PROJECT_ASSETS);
    expect(updated.assets).toContainEqual(newLogo);
    expect(updated.assets).not.toContainEqual(oldLogo);
    expect(komaProjectSchema.safeParse(updated).success).toBe(true);
  });
});
