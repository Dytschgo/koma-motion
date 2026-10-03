import { komaProjectSchema, type AssetReference, type ImageElement } from '@koma-motion/core';
import { buildKoma, buildPresentation, buildProject, buildShape } from '@koma-motion/core/testing';
import { PowerPointExporter } from '@koma-motion/exporters';
import { createAssetResolver, ElementView } from '@koma-motion/renderer';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it } from 'vitest';
import { unavailableImageAssetIds } from '../main/services/imageValidation';
import {
  selectHasUnsavedChanges,
  selectProject,
  useProjectStore,
} from '../renderer/src/state/projectStore';
import { collectAssetWarnings } from '../renderer/src/lib/assetHealth';
import { repairAssetCommand } from '../renderer/src/lib/assetRepairs';
import { collectHealthIssues } from '../renderer/src/lib/projectHealth';

const asset: AssetReference = {
  id: 'corrupt',
  type: 'image',
  name: 'Corrupt image',
  mediaType: 'image/png',
  projectPath: 'assets/corrupt.png',
  metadata: {},
  embeddedData: {
    encoding: 'base64',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlK3Y4AAAAASUVORK5CYII=',
  },
};
const image: ImageElement = {
  ...buildShape(),
  id: 'photo',
  type: 'image',
  content: { assetId: asset.id, altText: 'Photo' },
  style: { fit: 'contain', cornerRadius: 4 },
};
const replacement: AssetReference = {
  ...asset,
  id: 'fixed',
  embeddedData: {
    encoding: 'base64',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
  },
};
const fixture = () =>
  buildProject({
    assets: [asset],
    presentation: buildPresentation({
      komas: [buildKoma({ elements: [image, { ...image, id: 'photo-2', persistentId: 'other' }] })],
    }),
  });

afterEach(() => useProjectStore.getState().load(buildProject(), null));

it('agrees on a schema-valid corrupt PNG across trusted validation, health, editor and export', async () => {
  const project = fixture();
  expect(komaProjectSchema.safeParse(project).success).toBe(true);
  useProjectStore
    .getState()
    .load(project, null, [], null, unavailableImageAssetIds(project.assets));
  expect(selectProject(useProjectStore.getState())).toBe(project);
  expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(false);
  const issues = collectHealthIssues(project, [], null);
  expect(issues).toHaveLength(2);
  expect(issues[0]?.repair?.target).toMatchObject({ kind: 'image', elementId: image.id });
  expect(issues[0]?.message).toContain('stored bytes are kept');
  const resolve = createAssetResolver(project.assets);
  expect(resolve(asset.id).status).toBe('missing');
  const markup = renderToStaticMarkup(
    createElement(ElementView, {
      element: image,
      resolveAsset: resolve,
      selected: false,
      outlineWidth: 1,
    }),
  );
  expect(markup).toContain('Missing image');
  expect(markup).not.toContain('src=');
  const exported = await new PowerPointExporter().validate(project);
  expect(exported.issues.filter((issue) => issue.code === 'imageUnavailable')).toHaveLength(2);
});

it('repairs only the chosen reference, preserves shared corrupt bytes, and restores health on undo', () => {
  const original = fixture();
  useProjectStore
    .getState()
    .load(original, null, [], null, unavailableImageAssetIds(original.assets));
  const warning = collectAssetWarnings(original)[0]!;
  useProjectStore.getState().apply(repairAssetCommand(warning, replacement));
  const repaired = selectProject(useProjectStore.getState())!;
  expect(collectAssetWarnings(repaired).map((issue) => issue.target)).toEqual([
    {
      kind: 'image',
      komaId: original.presentation.komas[0]!.id,
      elementId: 'photo-2',
      assetId: asset.id,
    },
  ]);
  expect(repaired.assets).toEqual([asset, replacement]);
  expect(repaired.presentation.komas[0]!.elements[0]).toEqual({
    ...image,
    content: { ...image.content, assetId: replacement.id },
  });
  expect(createAssetResolver(repaired.assets)(replacement.id).status).toBe('available');
  useProjectStore.getState().undo();
  expect(selectProject(useProjectStore.getState())).toBe(original);
  expect(collectAssetWarnings(original)).toHaveLength(2);
  expect(createAssetResolver(original.assets)(asset.id).status).toBe('missing');
  useProjectStore.getState().redo();
  expect(collectAssetWarnings(selectProject(useProjectStore.getState())!)).toHaveLength(1);
});

it('matches exact bytes and clears previous project verdicts when switching projects', () => {
  const original = fixture();
  useProjectStore.getState().load(original, null, [], null, [asset.id]);
  const changedBytes = { ...replacement, id: asset.id };
  expect(createAssetResolver([changedBytes])(asset.id).status).toBe('available');
  useProjectStore.getState().load(original, null);
  expect(createAssetResolver(original.assets)(asset.id).status).toBe('available');
});
