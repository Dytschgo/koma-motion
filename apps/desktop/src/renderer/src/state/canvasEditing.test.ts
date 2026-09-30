import { createSeededIdGenerator, type AssetReference } from '@koma-motion/core';
import { buildKoma, buildPresentation, buildProject, buildText } from '@koma-motion/core/testing';
import { describe, expect, it } from 'vitest';
import { syncTransitions, validateTransition } from '@koma-motion/motion-engine';
import { changeElement, importImage } from './commands';
import { selectHasUnsavedChanges, selectProject, useProjectStore } from './projectStore';

const asset: AssetReference = {
  id: 'asset-test',
  type: 'image',
  name: 'test.png',
  mediaType: 'image/png',
  projectPath: 'assets/test.png',
  metadata: {},
  embeddedData: { encoding: 'base64', data: 'iVBORw0KGgo=' },
};
const ids = (): ReturnType<typeof createSeededIdGenerator> => createSeededIdGenerator('canvas');
const text = buildText({ id: 'text-1', persistentId: 'title' });
const koma = buildKoma({ id: 'koma-1', elements: [text] });
const base = buildProject({ presentation: buildPresentation({ komas: [koma], transitions: [] }) });

describe('canvas document commands', () => {
  it('commits text in one undo step and keeps stale motion detectable through redo', () => {
    const nextKoma = buildKoma({ id: 'koma-2', elements: [{ ...text, id: 'text-2' }] });
    const project = {
      ...base,
      presentation: syncTransitions(
        buildPresentation({ komas: [koma, nextKoma], transitions: [] }),
        ids(),
      ).presentation,
    };
    const transition = project.presentation.transitions[0];
    if (!transition) throw new Error('Expected transition');
    const store = useProjectStore;
    store.getState().load(project, null);
    store.getState().apply(changeElement(koma.id, { ...text, content: { text: 'First\nSecond' } }));
    const changed = selectProject(store.getState());
    if (!changed) throw new Error('Expected project');
    expect(store.getState().history?.past).toHaveLength(1);
    expect(selectHasUnsavedChanges(store.getState())).toBe(true);
    expect(changed.presentation.transitions).toBe(project.presentation.transitions);
    expect(
      validateTransition(transition, changed.presentation).map((issue) => issue.code),
    ).toContain('staleTransition');
    store.getState().undo();
    expect(selectProject(store.getState())).toBe(project);
    expect(selectHasUnsavedChanges(store.getState())).toBe(false);
    expect(validateTransition(transition, project.presentation)).toEqual([]);
    store.getState().redo();
    expect(selectProject(store.getState())).toBe(changed);
  });
  it('preserves identity and stored motion, ignores missing and unchanged elements', () => {
    const command = changeElement(koma.id, {
      ...text,
      persistentId: 'different',
      content: { text: 'Edited' },
    });
    const next = command(base, ids());
    expect(command.affectedKomaIds).toEqual([koma.id]);
    expect(next.presentation.komas[0]?.elements[0]).toMatchObject({
      id: text.id,
      persistentId: text.persistentId,
      content: { text: 'Edited' },
    });
    expect(next.presentation.transitions).toBe(base.presentation.transitions);
    expect(changeElement(koma.id, text)(base, ids())).toBe(base);
    expect(changeElement('missing', text)(base, ids())).toBe(base);
  });

  it('imports bytes and image atomically with dirty state, undo and redo', () => {
    const store = useProjectStore;
    store.getState().load(base, null);
    store.getState().apply(importImage(koma.id, asset));
    const imported = selectProject(store.getState());
    expect(imported?.assets).toEqual([asset]);
    expect(imported?.presentation.komas[0]?.elements).toHaveLength(2);
    expect(store.getState().history?.past).toHaveLength(1);
    expect(selectHasUnsavedChanges(store.getState())).toBe(true);
    store.getState().undo();
    expect(selectProject(store.getState())).toBe(base);
    expect(selectHasUnsavedChanges(store.getState())).toBe(false);
    store.getState().redo();
    expect(selectProject(store.getState())).toBe(imported);
  });

  it('replaces an image preserving geometry and identity; collects only its unused previous asset', () => {
    const imported = importImage(koma.id, asset)(base, ids());
    const original = imported.presentation.komas[0]?.elements[1];
    if (!original || original.type !== 'image') throw new Error('Expected image');
    const replacement = { ...asset, id: 'asset-new' };
    const next = importImage(koma.id, replacement, original.id)(imported, ids());
    expect(next.presentation.komas[0]?.elements[1]).toEqual({
      ...original,
      content: { ...original.content, assetId: replacement.id },
    });
    expect(next.assets).toEqual([replacement]);
    const shared = { ...imported, brandKit: { ...imported.brandKit, logoAssetId: asset.id } };
    expect(importImage(koma.id, replacement, original.id)(shared, ids()).assets).toEqual([
      asset,
      replacement,
    ]);
    expect(importImage(koma.id, replacement, 'missing')(imported, ids())).toBe(imported);
    expect(() => importImage(koma.id, { ...asset, embeddedData: null })(base, ids())).toThrow(
      'embedded',
    );
  });
});
