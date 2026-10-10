import { afterEach, describe, expect, it } from 'vitest';
import { reorderKoma } from '../state/commands';
import { selectHasUnsavedChanges, selectProject, useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { buildNavigationProject } from './deckNavigation.fixture';
import {
  AUTO_SCROLL_EDGE,
  AUTO_SCROLL_MAX_STEP,
  describeDragResult,
  dropKoma,
  exceedsDragStartDistance,
  getAutoScrollStep,
  getDropInsertion,
  getDropOffset,
} from './komaDrag';

afterEach(() => {
  useUiStore.getState().reset();
});

describe('Koma drag geometry', () => {
  it('starts a drag only after the pointer travels a few pixels, so clicks still select', () => {
    expect(exceedsDragStartDistance(0, 0)).toBe(false);
    expect(exceedsDragStartDistance(3, 3)).toBe(false);
    expect(exceedsDragStartDistance(0, 5)).toBe(true);
    expect(exceedsDragStartDistance(-4, -4)).toBe(true);
  });

  it('maps the pointer to the gap above the first Koma whose midline is below it', () => {
    const midlines = [50, 150, 250];
    expect(getDropInsertion(midlines, -20)).toBe(0);
    expect(getDropInsertion(midlines, 49)).toBe(0);
    expect(getDropInsertion(midlines, 50)).toBe(1);
    expect(getDropInsertion(midlines, 200)).toBe(2);
    expect(getDropInsertion(midlines, 251)).toBe(3);
    expect(getDropInsertion([], 10)).toBe(0);
  });

  it('turns a gap into the relative move used by the move buttons, with no move beside itself', () => {
    expect(getDropOffset(2, 2)).toBe(0);
    expect(getDropOffset(2, 3)).toBe(0);
    expect(getDropOffset(2, 0)).toBe(-2);
    expect(getDropOffset(2, 1)).toBe(-1);
    expect(getDropOffset(2, 4)).toBe(1);
    expect(getDropOffset(0, 5)).toBe(4);
  });

  it('scrolls only near the strip edges, faster closer to them, in the direction of travel', () => {
    const top = 100;
    const bottom = 600;
    const middle = 350;
    expect(getAutoScrollStep(middle, middle, top, bottom)).toBe(0);
    expect(getAutoScrollStep(top + AUTO_SCROLL_EDGE, middle, top, bottom)).toBe(0);
    expect(getAutoScrollStep(top + AUTO_SCROLL_EDGE - 1, middle, top, bottom)).toBeLessThan(0);
    expect(getAutoScrollStep(top, middle, top, bottom)).toBe(-AUTO_SCROLL_MAX_STEP);
    expect(getAutoScrollStep(top - 200, middle, top, bottom)).toBe(-AUTO_SCROLL_MAX_STEP);
    expect(getAutoScrollStep(bottom - 10, middle, top, bottom)).toBeGreaterThan(
      getAutoScrollStep(bottom - 40, middle, top, bottom),
    );
    expect(getAutoScrollStep(bottom + 50, middle, top, bottom)).toBe(AUTO_SCROLL_MAX_STEP);
    // A drag that starts near an edge does not scroll until it moves towards one.
    expect(getAutoScrollStep(top + 10, top + 10, top, bottom)).toBe(0);
    expect(getAutoScrollStep(top + 20, top + 10, top, bottom)).toBe(0);
    expect(getAutoScrollStep(top + 5, top + 10, top, bottom)).toBeLessThan(0);
    expect(getAutoScrollStep(bottom - 20, bottom - 10, top, bottom)).toBe(0);
    expect(getAutoScrollStep(bottom - 5, bottom - 10, top, bottom)).toBeGreaterThan(0);
    // A strip too short to have a middle never scrolls by itself.
    expect(getAutoScrollStep(100, 150, 100, 100 + AUTO_SCROLL_EDGE * 2)).toBe(0);
  });

  it('describes moves, drops in place and cancellation with 1-based positions', () => {
    expect(describeDragResult(0, 2)).toBe('Koma 1 moved to position 3.');
    expect(describeDragResult(4, -4)).toBe('Koma 5 moved to position 1.');
    expect(describeDragResult(1, 0)).toBe('Koma 2 stays at position 2.');
    expect(describeDragResult(1, null)).toBe('Move cancelled. Koma 2 stays at position 2.');
  });
});

describe('dropping a dragged Koma', () => {
  it('applies the same single undo step as a numbered position move and selects the Koma', () => {
    const project = buildNavigationProject();
    const store = useProjectStore;
    // New edges get fresh random IDs, so compare everything else.
    const withoutIds = (moved: typeof project | null) => ({
      komas: moved?.presentation.komas,
      transitions: moved?.presentation.transitions.map(({ id: _id, ...rest }) => rest),
    });
    store.getState().load(project, null);
    store.getState().apply(reorderKoma('koma-1', 2));
    const byPosition = selectProject(store.getState());

    store.getState().load(project, null);
    expect(dropKoma('koma-1', 3)).toEqual({ from: 0, offset: 2 });
    const byDrag = selectProject(store.getState());
    expect(withoutIds(byDrag)).toEqual(withoutIds(byPosition));
    // Unchanged adjacent pairs keep their stored transitions.
    for (const transition of byDrag?.presentation.transitions.slice(3) ?? [])
      expect(project.presentation.transitions).toContain(transition);
    expect(byDrag?.presentation.komas.slice(0, 3).map((koma) => koma.id)).toEqual([
      'koma-2',
      'koma-3',
      'koma-1',
    ]);
    expect(store.getState().history?.past).toHaveLength(1);
    expect(selectHasUnsavedChanges(store.getState())).toBe(true);
    expect(useUiStore.getState().selectedKomaId).toBe('koma-1');

    store.getState().undo();
    expect(selectProject(store.getState())).toBe(project);
    expect(selectHasUnsavedChanges(store.getState())).toBe(false);
    store.getState().redo();
    expect(selectProject(store.getState())).toBe(byDrag);
  });

  it('records nothing when the Koma is dropped beside itself or no longer exists', () => {
    const project = buildNavigationProject();
    const store = useProjectStore;
    store.getState().load(project, null);
    expect(dropKoma('koma-5', 4)).toEqual({ from: 4, offset: 0 });
    expect(dropKoma('koma-5', 5)).toEqual({ from: 4, offset: 0 });
    expect(dropKoma('missing', 0)).toBeNull();
    expect(selectProject(store.getState())).toBe(project);
    expect(store.getState().history?.past).toHaveLength(0);
  });

  it('moves to the end and the start of a long deck', () => {
    const project = buildNavigationProject();
    const store = useProjectStore;
    store.getState().load(project, null);
    expect(dropKoma('koma-1', 100)).toEqual({ from: 0, offset: 99 });
    expect(selectProject(store.getState())?.presentation.komas.at(-1)?.id).toBe('koma-1');
    expect(dropKoma('koma-1', 0)).toEqual({ from: 99, offset: -99 });
    expect(selectProject(store.getState())?.presentation.komas.map((koma) => koma.id)).toEqual(
      project.presentation.komas.map((koma) => koma.id),
    );
    expect(store.getState().history?.past).toHaveLength(2);
  });
});
