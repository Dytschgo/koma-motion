import { getStarterPreset } from '@koma-motion/brand-kit';
import { MAX_SYSTEM_INSTRUCTIONS_LENGTH } from '@koma-motion/core';
import { buildProject } from '@koma-motion/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { applyBrandProfile, applyStarterPreset, changeSystemInstructions } from './commands';
import { selectHasUnsavedChanges, selectProject, useProjectStore } from './projectStore';

afterEach(() => useProjectStore.setState({ history: null, savedProject: null, file: null }));
describe('instruction document commands', () => {
  it('applies template text as an unsaved, undoable project edit', () => {
    const project = buildProject({ systemInstructions: 'Original' });
    const store = useProjectStore.getState();
    store.load(project, null);
    store.apply(changeSystemInstructions('Template text'));
    expect(selectProject(useProjectStore.getState())?.systemInstructions).toBe('Template text');
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(true);
    store.undo();
    expect(selectProject(useProjectStore.getState())).toBe(project);
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(false);
    store.redo();
    expect(selectProject(useProjectStore.getState())?.systemInstructions).toBe('Template text');
    store.apply(changeSystemInstructions(''));
    expect(selectProject(useProjectStore.getState())?.systemInstructions).toBe('');
  });

  it('does not record no-ops or accept invalid edits', () => {
    useProjectStore.getState().load(buildProject(), null);
    const before = useProjectStore.getState().history;
    useProjectStore.getState().apply(changeSystemInstructions(''));
    expect(useProjectStore.getState().history).toBe(before);
    expect(() =>
      changeSystemInstructions('x'.repeat(MAX_SYSTEM_INSTRUCTIONS_LENGTH + 1)),
    ).toThrow();
    expect(useProjectStore.getState().history).toBe(before);
  });

  it('refuses a brand profile with overlong instructions before it reaches the project', () => {
    const starter = getStarterPreset('finance-report');
    expect(() =>
      applyBrandProfile(starter.brandKit, null, 'x'.repeat(MAX_SYSTEM_INSTRUCTIONS_LENGTH + 1)),
    ).toThrow();
  });

  it('applies a starter Brand Kit and instructions as one undoable step', () => {
    const project = buildProject({ systemInstructions: 'Original' });
    const starter = getStarterPreset('finance-report');
    const store = useProjectStore.getState();
    store.load(project, null);
    store.apply(applyStarterPreset(starter));
    const applied = selectProject(useProjectStore.getState());
    expect(applied?.systemInstructions).toBe(starter.systemInstructions);
    expect(applied?.brandKit).toEqual({ ...starter.brandKit, logoAssetId: null });
    store.undo();
    expect(selectProject(useProjectStore.getState())).toBe(project);
    const history = useProjectStore.getState().history;
    store.redo();
    store.apply(applyStarterPreset(starter));
    expect(useProjectStore.getState().history).not.toBe(history);
    const again = useProjectStore.getState().history;
    store.apply(applyStarterPreset(starter));
    expect(useProjectStore.getState().history).toBe(again);
  });
});
