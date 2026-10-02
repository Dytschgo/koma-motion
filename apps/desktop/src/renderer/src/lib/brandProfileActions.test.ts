import { createDefaultBrandKit } from '@koma-motion/brand-kit';
import { MAX_PROJECT_ASSETS, type AssetReference } from '@koma-motion/core';
import { buildProject } from '@koma-motion/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreparedMaterial } from '../../../shared/brandProfile';
import { useBrandProfileStore } from '../state/brandProfileStore';
import {
  selectCanUndo,
  selectHasUnsavedChanges,
  selectProject,
  useProjectStore,
} from '../state/projectStore';
import { invoke } from './api';
import {
  applyBrandProfileToProject,
  attachBrandMaterial,
  discardBrandMaterial,
} from './brandProfileActions';

vi.mock('./api', () => ({ invoke: vi.fn() }));

const ONE_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const logo = { name: 'logo.png', mediaType: 'image/png' as const, data: ONE_PIXEL };
const profile = {
  brandKit: { ...createDefaultBrandKit(), name: 'Northstar', tone: 'Calm' },
  logo,
  instructions: 'Use short headlines.',
};
const material = (sessionId: string): PreparedMaterial => ({
  sessionId,
  files: [{ file: 1, name: 'logo.png', kind: 'image', total: 1 }],
  exhibits: [
    {
      number: 1,
      file: 1,
      kind: 'image',
      page: null,
      text: '',
      mediaType: 'image/png',
      preview: ONE_PIXEL,
    },
  ],
  logos: [],
  warnings: [],
});
const session = () => useProjectStore.getState().sessionId;

beforeEach(() => {
  useProjectStore.getState().load(buildProject({ systemInstructions: 'Original' }), null);
  useBrandProfileStore.getState().clear();
  vi.mocked(invoke).mockReset();
});

describe('applying a brand profile', () => {
  it('changes kit, logo and instructions in one step that a single undo reverts', () => {
    const original = selectProject(useProjectStore.getState());
    expect(applyBrandProfileToProject(session(), profile)).toEqual({ status: 'applied' });
    const applied = selectProject(useProjectStore.getState());
    expect(applied?.systemInstructions).toBe('Use short headlines.');
    expect(applied?.brandKit).toMatchObject({ name: 'Northstar', tone: 'Calm' });
    expect(
      applied?.assets.find((asset) => asset.id === applied.brandKit.logoAssetId),
    ).toMatchObject({ name: 'logo.png', embeddedData: { data: ONE_PIXEL } });
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(true);

    useProjectStore.getState().undo();
    expect(selectProject(useProjectStore.getState())).toBe(original);
    expect(selectCanUndo(useProjectStore.getState())).toBe(false);
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(false);

    useProjectStore.getState().redo();
    expect(selectProject(useProjectStore.getState())).toBe(applied);
    // The same profile again is not a change and adds no undo step.
    const history = useProjectStore.getState().history;
    expect(applyBrandProfileToProject(session(), profile)).toEqual({ status: 'unchanged' });
    expect(useProjectStore.getState().history).toBe(history);
  });

  it('leaves the project untouched when it was replaced or cannot take the logo', () => {
    const stale = session();
    useProjectStore.getState().load(buildProject({ id: 'replacement' }), null);
    const replacement = useProjectStore.getState().history;
    expect(applyBrandProfileToProject(stale, profile)).toMatchObject({ status: 'failed' });
    expect(useProjectStore.getState().history).toBe(replacement);

    const assets: AssetReference[] = Array.from({ length: MAX_PROJECT_ASSETS }, (_, index) => ({
      id: `asset_${String(index)}`,
      type: 'image',
      name: `image-${String(index)}.png`,
      mediaType: 'image/png',
      projectPath: `assets/asset_${String(index)}.png`,
      metadata: { byteLength: 1 },
      embeddedData: null,
    }));
    useProjectStore.getState().load(buildProject({ systemInstructions: 'Original', assets }), null);
    const full = useProjectStore.getState().history;
    const outcome = applyBrandProfileToProject(session(), profile);
    expect(outcome).toMatchObject({ status: 'failed' });
    if (outcome.status === 'failed') expect(outcome.message).toContain('was not changed');
    // Not half applied: neither the instructions nor the kit changed.
    expect(useProjectStore.getState().history).toBe(full);
    expect(selectProject(useProjectStore.getState())?.systemInstructions).toBe('Original');
  });
});

describe('brand material in the chat', () => {
  it('attaches without touching project history and keeps files after a dismissed selection', async () => {
    const before = useProjectStore.getState().history;
    vi.mocked(invoke).mockImplementationOnce((_channel, request) =>
      Promise.resolve({
        status: 'prepared',
        material: material((request as { sessionId: string }).sessionId),
      }),
    );
    await attachBrandMaterial();
    const { draftId } = useBrandProfileStore.getState();
    expect(useBrandProfileStore.getState().material?.sessionId).toBe(draftId);
    expect(useProjectStore.getState().history).toBe(before);
    vi.mocked(invoke).mockResolvedValueOnce({ status: 'cancelled' });
    await attachBrandMaterial();
    expect(useBrandProfileStore.getState().material?.files).toHaveLength(1);
    expect(vi.mocked(invoke).mock.calls[1]?.[1]).toEqual({ sessionId: draftId });
  });

  it('shows a failed selection and leaves no draft after a dismissed first selection', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      status: 'failed',
      message: 'Choose at most 8 files.',
    });
    await attachBrandMaterial();
    expect(useBrandProfileStore.getState()).toMatchObject({
      material: null,
      attaching: false,
      error: 'Choose at most 8 files.',
    });
    vi.mocked(invoke).mockResolvedValueOnce({});
    await discardBrandMaterial();
    expect(useBrandProfileStore.getState().draftId).toBeNull();
    vi.mocked(invoke).mockResolvedValueOnce({ status: 'cancelled' });
    await attachBrandMaterial();
    expect(useBrandProfileStore.getState()).toMatchObject({ draftId: null, error: null });
  });

  it('ignores files prepared for a project that was replaced meanwhile', async () => {
    let finish: (value: unknown) => void = () => undefined;
    vi.mocked(invoke).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
    );
    const pending = attachBrandMaterial();
    const draftId = useBrandProfileStore.getState().draftId ?? '';
    useProjectStore.getState().load(buildProject({ id: 'replacement' }), null);
    finish({ status: 'prepared', material: material(draftId) });
    await pending;
    expect(useBrandProfileStore.getState().material).toBeNull();
    const replacement = useProjectStore.getState().history;
    expect(selectProject(useProjectStore.getState())?.id).toBe('replacement');
    expect(useProjectStore.getState().history).toBe(replacement);
  });
});
