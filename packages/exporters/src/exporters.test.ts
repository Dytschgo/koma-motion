import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildKoma, buildProject, buildShape, buildText } from '@koma-motion/core/testing';
import type { Koma, KomaProject, KomaTransition } from '@koma-motion/core';
import { buildTransition, computeFrame, validateTransition } from '@koma-motion/motion-engine';
import { imageSize } from 'image-size';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { PowerPointExporter } from './powerpoint/PowerPointExporter';
import { createExporters, getAvailableExporters } from './registry';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGO8YyTJwMDAxAAGAA7BASs+DrhaAAAAAElFTkSuQmCC';

vi.mock('image-size', { spy: true });

function storedTransition(id: string, from: Koma, to: Koma, duration: number): KomaTransition {
  const built = buildTransition({ id, from, to, suggestion: { duration, easing: 'linear' } });
  if (!built.ok) throw new Error('Cannot build export motion fixture');
  return built.value.transition;
}

function movingShapes(): KomaProject {
  const komas = [100, 400, 800].map((x, index) =>
    buildKoma({
      id: `koma-${index + 1}`,
      elements: [
        buildShape({ id: `shape-${index + 1}`, persistentId: 'engine', position: { x, y: 100 } }),
      ],
    }),
  );
  return buildProject({
    presentation: {
      ...buildProject().presentation,
      komas,
      transitions: [
        storedTransition('transition-1', komas[0]!, komas[1]!, 900),
        storedTransition('transition-2', komas[1]!, komas[2]!, 1200),
      ],
    },
  });
}

function threeKomas(): KomaProject {
  const shape1 = buildShape({
    id: 'shape-1',
    persistentId: 'engine',
    position: { x: 100, y: 100 },
    rotation: 25,
    zIndex: 2,
  });
  const text1 = buildText({ id: 'text-1', persistentId: 'headline', zIndex: 1 });
  const image = {
    id: 'image-1',
    persistentId: 'photo',
    name: 'Photo',
    type: 'image' as const,
    position: { x: 700, y: 100 },
    size: { width: 300, height: 200 },
    rotation: 0,
    opacity: 1,
    zIndex: 3,
    locked: false,
    visible: true,
    content: { assetId: 'asset-photo', altText: 'Pixel' },
    style: { fit: 'cover' as const, cornerRadius: 0 },
  };
  const group = {
    id: 'group-1',
    persistentId: 'group',
    name: 'Group',
    type: 'group' as const,
    position: { x: 100, y: 600 },
    size: { width: 400, height: 300 },
    rotation: 30,
    opacity: 0.8,
    zIndex: 4,
    locked: false,
    visible: true,
    content: {
      referenceSize: { width: 400, height: 300 },
      children: [
        buildShape({
          id: 'group-child',
          persistentId: 'child',
          position: { x: 10, y: 20 },
          size: { width: 80, height: 60 },
        }),
      ],
    },
    style: {},
  };
  const komas = [
    buildKoma({ id: 'koma-1', title: 'First', elements: [shape1, text1, image, group] }),
    buildKoma({
      id: 'koma-2',
      title: 'Second',
      elements: [
        buildShape({ id: 'shape-2', persistentId: 'engine', position: { x: 400, y: 200 } }),
        buildText({ id: 'text-2', persistentId: 'headline', content: { text: 'Second state' } }),
      ],
    }),
    buildKoma({
      id: 'koma-3',
      title: 'Third',
      elements: [
        buildShape({ id: 'shape-3', persistentId: 'engine', position: { x: 800, y: 400 } }),
      ],
    }),
  ];
  return buildProject({
    presentation: {
      ...buildProject().presentation,
      komas,
      transitions: [
        storedTransition('transition-1', komas[0]!, komas[1]!, 900),
        storedTransition('transition-2', komas[1]!, komas[2]!, 1200),
      ],
    },
    assets: [
      {
        id: 'asset-photo',
        type: 'image',
        name: 'Pixel',
        mediaType: 'image/png',
        projectPath: 'assets/pixel.png',
        metadata: {},
        embeddedData: { encoding: 'base64', data: PNG },
      },
    ],
  });
}

async function slideXml(zip: JSZip, number: number): Promise<string> {
  const slide = zip.file(`ppt/slides/slide${number}.xml`);
  if (!slide) throw new Error(`Missing slide ${number}`);
  return slide.async('string');
}

describe('PowerPointExporter', () => {
  const exporter = new PowerPointExporter();

  it('writes each saved hold separately from motion duration and respects the global fallback and final slide', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'koma-hold-export-'));
    try {
      const project = movingShapes();
      project.presentation.komas[0]!.holdDurationMs = 1250;
      project.presentation.komas[1]!.holdDurationMs = 7000;
      project.presentation.komas[2]!.holdDurationMs = 60000;
      const filePath = join(directory, 'holds.pptx');
      const options = {
        filePath,
        motion: 'morph' as const,
        autoAdvance: true,
        defaultHoldDurationMs: 2200,
      };
      expect((await exporter.export(project, options)).status).toBe('exported');
      let zip = await JSZip.loadAsync(await readFile(filePath));
      expect(await slideXml(zip, 1)).toContain('advTm="1250"');
      expect(await slideXml(zip, 2)).toContain('advTm="7000"');
      expect(await slideXml(zip, 2)).toContain('p14:dur="900"');
      expect(await slideXml(zip, 3)).toContain('p14:dur="1200"');
      expect(await slideXml(zip, 3)).not.toContain('advTm=');
      project.presentation.komas[1]!.holdDurationMs = null;
      expect((await exporter.export(project, options)).status).toBe('exported');
      zip = await JSZip.loadAsync(await readFile(filePath));
      expect(await slideXml(zip, 1)).toContain('advTm="1250"');
      expect(await slideXml(zip, 2)).toContain('advTm="2200"');
      expect((await exporter.export(project, { ...options, autoAdvance: false })).status).toBe(
        'exported',
      );
      zip = await JSZip.loadAsync(await readFile(filePath));
      for (const number of [1, 2, 3]) expect(await slideXml(zip, number)).not.toContain('advTm=');
      expect(
        (await exporter.export(project, { ...options, defaultHoldDurationMs: 999 })).status,
      ).toBe('failed');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses Morph for the same compatible continuous motion playback interpolates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'koma-export-'));
    try {
      const project = movingShapes();
      const from = project.presentation.komas[0]!;
      const to = project.presentation.komas[1]!;
      const transition = project.presentation.transitions[0]!;
      expect(validateTransition(transition, project.presentation)).toEqual([]);
      expect(
        computeFrame({ from, to, transition, progress: 0.5 }).layers[0]?.element.position.x,
      ).toBe(250);
      const original = structuredClone(project);
      const path = join(directory, 'compatible.pptx');
      const result = await exporter.export(project, {
        filePath: path,
        motion: 'morph',
        autoAdvance: true,
      });
      expect(result.status).toBe('exported');
      if (result.status === 'exported') {
        expect(result.warnings.map(({ code }) => code)).not.toContain('invalidStoredMotion');
        expect(result.warnings.map(({ code }) => code)).not.toContain('transitionFadeFallback');
      }
      const zip = await JSZip.loadAsync(await readFile(path));
      expect(await slideXml(zip, 2)).toContain('<p159:morph option="byObject"/>');
      expect(await slideXml(zip, 2)).toContain('p14:dur="900"');
      expect(await slideXml(zip, 1)).toContain('advTm="5000"');
      expect(await slideXml(zip, 2)).toContain('advTm="5000"');
      expect(project).toEqual(original);
      if (process.env.KOMA_EXPORT_FIXTURE_DIR) {
        await mkdir(process.env.KOMA_EXPORT_FIXTURE_DIR, { recursive: true });
        await copyFile(
          path,
          join(process.env.KOMA_EXPORT_FIXTURE_DIR, 'compatible-morph-three-komas.pptx'),
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    'editedTarget',
    'emptyOperations',
    'wrongElementReference',
    'duplicateOperation',
  ] as const)(
    'warns and fades %s motion blocked by playback while preserving the source and static export',
    async (failure) => {
      const directory = await mkdtemp(join(tmpdir(), 'koma-export-'));
      try {
        const project = movingShapes();
        const transition = project.presentation.transitions[0]!;
        const operation = transition.elementTransitions[0]!;
        if (failure === 'editedTarget') {
          const target = project.presentation.komas[1]!;
          project.presentation.komas[1] = {
            ...target,
            elements: target.elements.map((element) => ({
              ...element,
              position: { x: 600, y: 100 },
            })),
          };
        } else if (failure === 'emptyOperations') {
          transition.elementTransitions = [];
        } else if (failure === 'wrongElementReference') {
          transition.elementTransitions = [
            { ...operation, to: { ...operation.to, elementId: 'wrong-element' } },
          ];
        } else {
          transition.elementTransitions = [operation, operation];
        }
        const original = structuredClone(project);
        const from = project.presentation.komas[0]!;
        const to = project.presentation.komas[1]!;
        expect(
          validateTransition(transition, project.presentation).map(({ code }) => code),
        ).toContain(
          failure === 'wrongElementReference'
            ? 'invalidElementReference'
            : failure === 'duplicateOperation'
              ? 'duplicateOperation'
              : 'staleTransition',
        );
        expect(
          computeFrame({ from, to, transition, progress: 0.5 }).layers[0]?.element.position,
        ).toEqual(from.elements[0]?.position);
        const validation = await exporter.validate(project);
        expect(validation.exportable).toBe(true);
        expect(validation.issues).toContainEqual(
          expect.objectContaining({ severity: 'warning', code: 'invalidStoredMotion' }),
        );
        for (const motion of ['morph', 'fade', 'static'] as const) {
          const path = join(directory, `${motion}.pptx`);
          const result = await exporter.export(project, {
            filePath: path,
            motion,
            autoAdvance: true,
          });
          expect(result.status).toBe('exported');
          if (result.status === 'exported')
            expect(result.warnings.map(({ code }) => code)).toContain('invalidStoredMotion');
          const zip = await JSZip.loadAsync(await readFile(path));
          const second = await slideXml(zip, 2);
          expect(second).toContain('!!engine');
          expect(second).not.toContain('<p159:morph');
          if (motion === 'static') {
            expect(second).not.toContain('<p:transition');
          } else {
            expect(second).toContain('<p:fade/>');
            expect(second).toContain('p14:dur="500"');
            expect(await slideXml(zip, 1)).toContain('advTm="5000"');
          }
        }
        expect(project).toEqual(original);
        if (failure === 'editedTarget' && process.env.KOMA_EXPORT_FIXTURE_DIR) {
          await mkdir(process.env.KOMA_EXPORT_FIXTURE_DIR, { recursive: true });
          await copyFile(
            join(directory, 'morph.pptx'),
            join(process.env.KOMA_EXPORT_FIXTURE_DIR, 'stale-motion-fade.pptx'),
          );
          await writeFile(
            join(process.env.KOMA_EXPORT_FIXTURE_DIR, 'stale-motion-source.json'),
            JSON.stringify(project, null, 2),
          );
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it('verifies each referenced asset once for warnings and placement and rechecks it on the next export', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'koma-export-'));
    try {
      const source = threeKomas();
      const picture = source.presentation.komas[0]!.elements.find(
        (element) => element.type === 'image',
      );
      if (picture?.type !== 'image') throw new Error('Missing picture fixture');
      const asset = source.assets[0]!;
      const project = buildProject({
        assets: [
          asset,
          {
            ...asset,
            id: 'corrupt',
            embeddedData: {
              encoding: 'base64',
              data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlK3Y4AAAAASUVORK5CYII=',
            },
          },
        ],
      });
      project.presentation.komas = [1, 2, 3].map((index) =>
        buildKoma({
          id: `koma-${index}`,
          elements: [
            picture,
            {
              ...picture,
              id: 'bad-picture',
              persistentId: 'bad-picture',
              content: { assetId: 'corrupt', altText: 'Corrupt' },
            },
          ],
        }),
      );
      const original = structuredClone(project);
      vi.mocked(imageSize).mockClear();
      const path = join(directory, 'repeated.pptx');
      const result = await exporter.export(project, { filePath: path });
      expect(result.status).toBe('exported');
      if (result.status === 'exported')
        expect(result.warnings.filter(({ code }) => code === 'imageUnavailable')).toHaveLength(3);
      expect(imageSize).toHaveBeenCalledTimes(2);
      const zip = await JSZip.loadAsync(await readFile(path));
      for (const index of [1, 2, 3]) {
        const xml = await slideXml(zip, index);
        expect(xml.match(/<p:pic>/g)).toHaveLength(1);
        expect(xml).toContain('Missing image');
      }
      expect(project).toEqual(original);
      project.assets[1]!.embeddedData = { encoding: 'base64', data: PNG };
      vi.mocked(imageSize).mockClear();
      expect(await exporter.export(project, { filePath: path })).toMatchObject({
        status: 'exported',
        warnings: [],
      });
      expect(imageSize).toHaveBeenCalledTimes(2);
      const repaired = await JSZip.loadAsync(await readFile(path));
      for (const index of [1, 2, 3]) {
        const xml = await slideXml(repaired, index);
        expect(xml.match(/<p:pic>/g)).toHaveLength(2);
        expect(xml).not.toContain('Missing image');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves rounded corner units and text size in scaled groups', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'koma-export-'));
    try {
      const group = threeKomas().presentation.komas[0]!.elements.find(
        (element) => element.type === 'group',
      );
      if (group?.type !== 'group') throw new Error('Missing group fixture');
      const project = buildProject();
      project.presentation.komas[0]!.elements = [
        buildShape({
          size: { width: 100, height: 60 },
          content: { shape: 'roundedRectangle', cornerRadius: 10 },
        }),
        buildShape({
          id: 'square-corner',
          persistentId: 'square-corner',
          content: { shape: 'roundedRectangle', cornerRadius: 0 },
        }),
        {
          ...group,
          position: { x: 100, y: 350 },
          size: { width: 800, height: 600 },
          content: {
            ...group.content,
            children: [buildText({ position: { x: 20, y: 20 }, content: { text: 'Scaled text' } })],
          },
        },
      ];
      const path = join(directory, 'scaled.pptx');
      expect((await exporter.export(project, { filePath: path })).status).toBe('exported');
      const xml = await slideXml(await JSZip.loadAsync(await readFile(path)), 1);
      // Ten logical pixels is one sixth of this rectangle's 60-pixel short side.
      expect(xml).toContain('name="adj" fmla="val 16667"');
      expect(xml).toContain('prst="rect"');
      // A 64-pixel font in a 2x group is 64 points on a 7.5-inch-high slide.
      expect(xml).toContain('sz="6400"');
      if (process.env.KOMA_EXPORT_FIXTURE_DIR) {
        await mkdir(process.env.KOMA_EXPORT_FIXTURE_DIR, { recursive: true });
        await copyFile(path, join(process.env.KOMA_EXPORT_FIXTURE_DIR, 'scaled-group.pptx'));
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('writes editable objects with stacking, Morph identity names, and per-element fade fallback', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'koma-export-'));
    try {
      const path = join(directory, 'presentation.pptx');
      const result = await exporter.export(threeKomas(), {
        filePath: path,
        motion: 'morph',
        autoAdvance: true,
      });
      expect(result.status).toBe('exported');
      const zip = await JSZip.loadAsync(await readFile(path));
      const first = await slideXml(zip, 1);
      const second = await slideXml(zip, 2);
      const third = await slideXml(zip, 3);
      expect(first).toContain('Presentations are frames.');
      expect(first).toContain('!!headline');
      expect(first).toContain('!!engine');
      expect(first).toContain('!!photo');
      expect(first).toContain('!!child');
      expect(first.indexOf('!!headline')).toBeLessThan(first.indexOf('!!engine'));
      expect(second).toContain('!!engine');
      expect(third).toContain('!!engine');
      expect(second).toContain('<p:fade/>');
      expect(second).not.toContain('<p159:morph');
      expect(third).toContain('<p:fade/>');
      expect(third).not.toContain('<p159:morph');
      expect(second).toContain('p14:dur="900"');
      expect(third).toContain('p14:dur="1200"');
      expect(first).toContain('advTm="5000"');
      expect(second).toContain('advTm="5000"');
      expect(zip.file(/ppt\/media\//).length).toBe(1);
      expect(zip.file(/ppt\/slides\/slide\d+\.xml$/).length).toBe(3);
      if (process.env.KOMA_EXPORT_FIXTURE_DIR) {
        await mkdir(process.env.KOMA_EXPORT_FIXTURE_DIR, { recursive: true });
        await copyFile(
          path,
          join(process.env.KOMA_EXPORT_FIXTURE_DIR, 'editable-fade-three-komas.pptx'),
        );
      }
      if (result.status === 'exported') {
        expect(result.warnings.map((item) => item.code)).toContain('motionApproximation');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('emits fade transitions and leaves source file intact on invalid input', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'koma-export-'));
    try {
      const path = join(directory, 'presentation.pptx');
      const fade = await exporter.export(threeKomas(), { filePath: path, motion: 'fade' });
      expect(fade.status).toBe('exported');
      const bytes = await readFile(path);
      const zip = await JSZip.loadAsync(bytes);
      expect(await slideXml(zip, 2)).toContain('<p:fade/>');
      const invalid = {
        ...threeKomas(),
        presentation: {
          ...threeKomas().presentation,
          komas: [],
        },
      };
      expect(await exporter.export(invalid, { filePath: path })).toMatchObject({
        status: 'failed',
      });
      expect(await readFile(path)).toEqual(bytes);
      expect(await readdir(directory)).toEqual(['presentation.pptx']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses a fade when staged motion cannot be represented by Morph', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'koma-export-'));
    try {
      const project = movingShapes();
      const staged = {
        ...project,
        presentation: {
          ...project.presentation,
          transitions: project.presentation.transitions.map((transition, index) =>
            index === 0 ? { ...transition, strategy: 'staged' as const } : transition,
          ),
        },
      };
      const path = join(directory, 'staged.pptx');
      const result = await exporter.export(staged, { filePath: path, motion: 'morph' });
      expect(result.status).toBe('exported');
      if (result.status === 'exported') {
        expect(result.warnings.map((item) => item.code)).toContain('transitionFadeFallback');
      }
      const zip = await JSZip.loadAsync(await readFile(path));
      expect(await slideXml(zip, 2)).toContain('<p:fade/>');
      expect(await slideXml(zip, 2)).not.toContain('<p159:morph');
      expect(await slideXml(zip, 3)).toContain('<p159:morph');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('warns and uses a placeholder for an unavailable image', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'koma-export-'));
    try {
      const project = { ...threeKomas(), assets: [] };
      const path = join(directory, 'missing.pptx');
      const result = await exporter.export(project, { filePath: path });
      expect(result.status).toBe('exported');
      if (result.status === 'exported') {
        expect(result.warnings.map((item) => item.code)).toContain('imageUnavailable');
      }
      const zip = await JSZip.loadAsync(await readFile(path));
      expect(await slideXml(zip, 1)).toContain('Missing image');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a corrupt PNG stream before placing it in the package', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'koma-export-'));
    try {
      const project = threeKomas();
      const corrupt = {
        ...project,
        assets: project.assets.map((asset) => ({
          ...asset,
          embeddedData: {
            encoding: 'base64' as const,
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlK3Y4AAAAASUVORK5CYII=',
          },
        })),
      };
      const path = join(directory, 'corrupt.pptx');
      const result = await exporter.export(corrupt, { filePath: path });
      expect(result.status).toBe('exported');
      if (result.status === 'exported') {
        expect(result.warnings.map((item) => item.code)).toContain('imageUnavailable');
      }
      const zip = await JSZip.loadAsync(await readFile(path));
      expect(zip.file(/ppt\/media\//)).toHaveLength(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps filesystem error paths out of export failures', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'koma-export-'));
    try {
      const result = await exporter.export(threeKomas(), {
        filePath: join(directory, 'private-directory', 'confidential-deck.pptx'),
      });
      expect(result.status).toBe('failed');
      expect(JSON.stringify(result)).not.toContain(directory);
      expect(JSON.stringify(result)).not.toContain('private-directory');
      expect(JSON.stringify(result)).not.toContain('confidential-deck');
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves an existing destination if file generation fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'koma-export-'));
    try {
      const path = join(directory, 'existing.pptx');
      await writeFile(path, 'original');
      const broken = {
        ...threeKomas(),
        presentation: {
          ...threeKomas().presentation,
          komas: [],
        },
      };
      expect((await exporter.export(broken, { filePath: path })).status).toBe('failed');
      expect(await readFile(path, 'utf8')).toBe('original');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('exporter registry', () => {
  it('offers the verified PowerPoint exporter', () => {
    expect(createExporters().map((exporter) => exporter.id)).toEqual(['powerpoint']);
    expect(getAvailableExporters().map((exporter) => exporter.id)).toEqual(['powerpoint']);
  });
});
