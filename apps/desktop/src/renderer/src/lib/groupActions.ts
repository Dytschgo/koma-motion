/**
 * Group and Ungroup for the current selection, shared by the canvas toolbar,
 * the Inspector and the keyboard shortcuts.
 */
import { checkGroupable, type GroupElement, type Koma } from '@koma-motion/core';
import { groupKomaElements, ungroupKomaElement } from '../state/commands';
import { selectProject, useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';

export interface GroupingAvailability {
  /** The selection can become one group. */
  readonly canGroup: boolean;
  /** The selection is one group that can be dissolved. */
  readonly group: GroupElement | null;
}

/** What Group and Ungroup can do with `selection` on `koma`. */
export function getGroupingAvailability(
  koma: Koma | null,
  selection: readonly string[],
): GroupingAvailability {
  if (koma === null) return { canGroup: false, group: null };
  const [only] = selection;
  const element =
    selection.length === 1 ? koma.elements.find((candidate) => candidate.id === only) : undefined;
  return {
    canGroup: checkGroupable(koma, selection) === null,
    group: element?.type === 'group' && !element.locked ? element : null,
  };
}

/** The Koma the canvas shows: the selected one, or the first. */
function currentKoma(): Koma | null {
  const komas = selectProject(useProjectStore.getState())?.presentation.komas ?? [];
  const { selectedKomaId } = useUiStore.getState();
  return komas.find((koma) => koma.id === selectedKomaId) ?? komas[0] ?? null;
}

function report(error: unknown, fallback: string): void {
  useUiStore.getState().notify('error', error instanceof Error ? error.message : fallback);
}

/**
 * Groups the selected elements as one undoable step and selects the new
 * group. A selection of fewer than two elements is ignored; other problems
 * are explained in a notice. Returns whether a group was created.
 */
export function groupSelection(): boolean {
  const ui = useUiStore.getState();
  const koma = currentKoma();
  if (koma === null || ui.preview !== null || ui.selectedElementIds.length < 2) return false;
  const known = new Set(koma.elements.map((element) => element.id));
  try {
    useProjectStore.getState().apply(groupKomaElements(koma.id, ui.selectedElementIds));
  } catch (error) {
    report(error, 'The elements could not be grouped.');
    return false;
  }
  const created = currentKoma()?.elements.find(
    (element) => element.type === 'group' && !known.has(element.id),
  );
  if (created === undefined) return false;
  useUiStore.getState().selectElement(created.id);
  return true;
}

/**
 * Dissolves the selected group as one undoable step and selects its former
 * children. Returns whether a group was dissolved.
 */
export function ungroupSelection(): boolean {
  const ui = useUiStore.getState();
  const koma = currentKoma();
  if (ui.preview !== null) return false;
  const { group } = getGroupingAvailability(koma, ui.selectedElementIds);
  if (koma === null || group === null) return false;
  try {
    useProjectStore.getState().apply(ungroupKomaElement(koma.id, group.id));
  } catch (error) {
    report(error, 'The group could not be dissolved.');
    return false;
  }
  useUiStore.getState().selectElements(group.content.children.map((child) => child.id));
  return true;
}
