import {
  collectProjectWarnings,
  createSeededIdGenerator,
  type AssetReference,
  type ImageElement,
} from '@koma-motion/core';
import { buildKoma, buildPresentation, buildProject, buildShape } from '@koma-motion/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLogo } from '../state/commands';
import { selectHasUnsavedChanges, selectProject, useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { invoke } from './api';
import { repairAsset, repairAssetCommand } from './assetRepairs';
import { collectHealthIssues } from './projectHealth';
import { saveProject } from './projectActions';

vi.mock('./api', () => ({ invoke: vi.fn() }));
const ids = createSeededIdGenerator('repair');
const image: ImageElement = {
  ...buildShape(),
  id: 'photo',
  type: 'image',
  content: { assetId: 'missing', altText: 'Keep this description' },
  style: { fit: 'cover', cornerRadius: 8 },
};
const unavailable: AssetReference = {
  id: 'missing',
  type: 'image',
  name: 'old.png',
  mediaType: 'image/png',
  projectPath: 'assets/old.png',
  metadata: {},
  embeddedData: null,
};
const replacement: AssetReference = {
  ...unavailable,
  id: 'new',
  name: 'new.png',
  projectPath: 'assets/new.png',
  embeddedData: { encoding: 'base64', data: 'aGVsbG8=' },
};
const fixture = () =>
  buildProject({
    assets: [unavailable],
    brandKit: { ...buildProject().brandKit, logoAssetId: unavailable.id },
    presentation: buildPresentation({
      komas: [buildKoma({ elements: [image, { ...image, id: 'photo-2', persistentId: 'other' }] })],
    }),
  });

beforeEach(() => {
  useProjectStore.getState().load(fixture(), null);
  useUiStore.getState().reset();
  vi.mocked(invoke).mockReset();
});

describe('targeted asset recovery', () => {
  it('replaces only the affected image, keeps identity/styles/shared bytes, and supports undo/redo', async () => {
    const original = selectProject(useProjectStore.getState())!;
    const warning = collectProjectWarnings(original).find(
      (issue) => issue.target.kind === 'image',
    )!;
    vi.mocked(invoke).mockResolvedValue({ status: 'selected', asset: replacement });
    expect(await repairAsset(warning, 'replace')).toMatchObject({ status: 'fixed' });
    expect(invoke).toHaveBeenCalledWith('koma:project:select-image', {});
    const next = selectProject(useProjectStore.getState())!;
    expect(next.presentation.komas[0]!.elements[0]).toEqual({
      ...image,
      content: { ...image.content, assetId: replacement.id },
    });
    expect(next.presentation.komas[0]!.elements[1]).toEqual(
      original.presentation.komas[0]!.elements[1],
    );
    expect(next.assets).toEqual([unavailable, replacement]);
    expect(collectProjectWarnings(next).map((issue) => issue.id)).not.toContain(warning.id);
    expect(useProjectStore.getState().history!.past).toHaveLength(1);
    useProjectStore.getState().undo();
    expect(selectProject(useProjectStore.getState())).toBe(original);
    useProjectStore.getState().redo();
    expect(selectProject(useProjectStore.getState())).toBe(next);
  });

  it('targets a grouped child and leaves its siblings, group and stored motion unchanged', () => {
    const project = buildProject({
      presentation: buildPresentation({
        komas: [
          buildKoma({
            elements: [
              {
                ...buildShape(),
                type: 'group',
                style: {},
                content: { referenceSize: image.size, children: [image, buildShape()] },
              },
            ],
          }),
        ],
      }),
    });
    const warning = collectProjectWarnings(project)[0]!;
    const next = repairAssetCommand(warning, replacement)(project, ids);
    const group = next.presentation.komas[0]!.elements[0]!;
    if (group.type !== 'group') throw new Error('Expected group');
    expect(group.content.children).toEqual([
      { ...image, content: { ...image.content, assetId: replacement.id } },
      buildShape(),
    ]);
    expect(next.presentation.transitions).toBe(project.presentation.transitions);
  });

  it('clears the logo with confirmation and preserves an asset still referenced by images', async () => {
    const original = selectProject(useProjectStore.getState())!;
    const pending = repairAsset(collectProjectWarnings(original)[0]!, 'remove');
    expect(useUiStore.getState().confirmation?.title).toBe('Clear logo?');
    useUiStore.getState().answerConfirmation(true);
    expect(await pending).toMatchObject({ status: 'fixed' });
    expect(selectProject(useProjectStore.getState())!.brandKit.logoAssetId).toBeNull();
    expect(selectProject(useProjectStore.getState())!.assets).toEqual([unavailable]);
    useProjectStore.getState().undo();
    expect(selectProject(useProjectStore.getState())).toBe(original);
  });

  it('requires confirmation before removing one image and keeps its shared asset and other references', async () => {
    const original = selectProject(useProjectStore.getState())!;
    const warning = collectProjectWarnings(original).find(
      (issue) => issue.target.kind === 'image',
    )!;
    const cancelled = repairAsset(warning, 'remove');
    useUiStore.getState().answerConfirmation(false);
    expect((await cancelled).status).toBe('cancelled');
    expect(selectProject(useProjectStore.getState())).toBe(original);
    const pending = repairAsset(warning, 'remove');
    useUiStore.getState().answerConfirmation(true);
    expect((await pending).status).toBe('fixed');
    const next = selectProject(useProjectStore.getState())!;
    expect(next.presentation.komas[0]!.elements).toEqual([
      original.presentation.komas[0]!.elements[1],
    ]);
    expect(next.assets).toEqual([unavailable]);
    expect(next.brandKit).toBe(original.brandKit);
    useProjectStore.getState().undo();
    expect(selectProject(useProjectStore.getState())).toBe(original);
  });

  it('replaces an unavailable logo through the trusted picker', async () => {
    const warning = collectProjectWarnings(fixture())[0]!;
    vi.mocked(invoke).mockResolvedValue({ status: 'selected', asset: replacement });
    expect(await repairAsset(warning, 'replace')).toMatchObject({ status: 'fixed' });
    expect(invoke).toHaveBeenCalledWith('koma:brand-kit:select-logo', {});
    expect(selectProject(useProjectStore.getState())!.brandKit.logoAssetId).toBe(replacement.id);
    expect(
      collectProjectWarnings(selectProject(useProjectStore.getState())!).some(
        (item) => item.id === 'logo',
      ),
    ).toBe(false);
  });

  it.each(['cancelled', 'failed'] as const)(
    'keeps document, history, warning and Brand Kit draft on picker %s',
    async (status) => {
      const original = selectProject(useProjectStore.getState())!;
      const warning = collectProjectWarnings(original)[0]!;
      const raw = { name: 'A draft ', primaryColour: 'invalid' };
      useUiStore.getState().setBrandKitDraft(original.id, raw);
      vi.mocked(invoke).mockResolvedValue(
        status === 'failed' ? { status, message: 'Cannot read image' } : { status },
      );
      expect(await repairAsset(warning, 'replace')).toMatchObject({ status });
      expect(selectProject(useProjectStore.getState())).toBe(original);
      expect(useProjectStore.getState().history!.past).toHaveLength(0);
      expect(useUiStore.getState().brandKitDraft!.raw).toBe(raw);
      expect(collectProjectWarnings(original)[0]).toEqual(warning);
    },
  );

  it('does not apply a late picker result to a replacement project', async () => {
    let finish!: (value: { status: 'selected'; asset: AssetReference }) => void;
    vi.mocked(invoke).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = repairAsset(collectProjectWarnings(fixture())[0]!, 'replace');
    const other = buildProject({ name: 'Other' });
    useProjectStore.getState().load(other, null);
    finish({ status: 'selected', asset: replacement });
    expect(await pending).toMatchObject({ status: 'cancelled' });
    expect(selectProject(useProjectStore.getState())).toBe(other);
  });

  it('rejects a repair when the target changed during the native picker', async () => {
    let finish!: (value: { status: 'selected'; asset: AssetReference }) => void;
    vi.mocked(invoke).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = repairAsset(collectProjectWarnings(fixture())[0]!, 'replace');
    useProjectStore.getState().apply(changeLogo(null));
    const before = useProjectStore.getState().history;
    finish({ status: 'selected', asset: replacement });
    const result = await pending;
    expect(result.status).toBe('failed');
    expect(result.message).toContain('changed');
    expect(useProjectStore.getState().history).toBe(before);
  });

  it('rejects a replacement without embedded bytes and keeps history untouched', async () => {
    const before = useProjectStore.getState().history;
    vi.mocked(invoke).mockResolvedValue({ status: 'selected', asset: unavailable });
    expect(await repairAsset(collectProjectWarnings(fixture())[0]!, 'replace')).toMatchObject({
      status: 'failed',
    });
    expect(useProjectStore.getState().history).toBe(before);
  });

  it('rejects invalid document data before committing a change', async () => {
    const before = useProjectStore.getState().history;
    vi.mocked(invoke).mockResolvedValue({
      status: 'selected',
      asset: { ...replacement, name: '' },
    });
    expect(await repairAsset(collectProjectWarnings(fixture())[0]!, 'replace')).toMatchObject({
      status: 'failed',
    });
    expect(useProjectStore.getState().history).toBe(before);
  });

  it('honours image and group locks', () => {
    const project = buildProject({
      presentation: buildPresentation({
        komas: [buildKoma({ elements: [{ ...image, locked: true }] })],
      }),
    });
    expect(() =>
      repairAssetCommand(collectProjectWarnings(project)[0]!, replacement)(project, ids),
    ).toThrow('Unlock');
  });
});

describe('health state', () => {
  it('reports a health save failure inline without duplicating a persistent toast or changing history', async () => {
    const before = useProjectStore.getState().history;
    const notices = useUiStore.getState().notices;
    const onFailure = vi.fn();
    vi.mocked(invoke).mockResolvedValue({
      status: 'failed',
      message: 'The file could not be written.',
    });
    expect(await saveProject(onFailure)).toBe(false);
    expect(onFailure).toHaveBeenCalledWith('The file could not be written.');
    expect(useProjectStore.getState().history).toBe(before);
    expect(useUiStore.getState().notices).toBe(notices);
  });
  it('drops stale asset load messages, deduplicates static messages and derives live issues after undo', () => {
    const project = fixture();
    useProjectStore
      .getState()
      .load(project, null, [
        ...collectProjectWarnings(project).map((issue) => issue.message),
        'Unknown data',
        'Unknown data',
      ]);
    expect(useProjectStore.getState().loadWarnings).toEqual(['Unknown data']);
    useProjectStore.getState().apply(changeLogo(null));
    expect(
      collectHealthIssues(
        selectProject(useProjectStore.getState()),
        useProjectStore.getState().loadWarnings,
        null,
      ).filter((issue) => issue.repair?.id === 'logo'),
    ).toHaveLength(0);
    useProjectStore.getState().undo();
    expect(
      collectHealthIssues(selectProject(useProjectStore.getState()), [], null).filter(
        (issue) => issue.repair?.id === 'logo',
      ),
    ).toHaveLength(1);
  });

  it('shows migration as information and pending save without an undo entry, then clears it on accepted save', () => {
    const project = buildProject();
    useProjectStore
      .getState()
      .load(project, null, ['The project was upgraded from format version 1.'], 1);
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(true);
    expect(collectHealthIssues(project, useProjectStore.getState().loadWarnings, 1)).toMatchObject([
      { id: 'migration', severity: 'info' },
    ]);
    expect(useProjectStore.getState().history!.past).toHaveLength(0);
    useProjectStore
      .getState()
      .markSaved(
        project,
        project,
        { fileName: 'copy.koma', displayPath: 'copy.koma' },
        useProjectStore.getState().claimSave()!,
      );
    expect(useProjectStore.getState().migratedFrom).toBeNull();
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(false);
  });
});
