import { createElement } from '../state/commands';
import { selectProject, useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import type { AuthoringKind } from './authoring';

/**
 * Adds a new element of `kind` to the selected Koma and selects it. Nothing
 * happens without a selected Koma or while a preview plays.
 */
export function addElementToSelectedKoma(kind: AuthoringKind): void {
  const ui = useUiStore.getState();
  const project = selectProject(useProjectStore.getState());
  const komas = project?.presentation.komas ?? [];
  // The canvas shows the first Koma until another one is selected.
  const koma = komas.find((item) => item.id === ui.selectedKomaId) ?? komas[0];
  if (koma === undefined || ui.preview !== null) return;
  const known = new Set(koma.elements.map((element) => element.id));
  try {
    useProjectStore.getState().apply(createElement(koma.id, kind));
    const added = selectProject(useProjectStore.getState())
      ?.presentation.komas.find((item) => item.id === koma.id)
      ?.elements.find((element) => !known.has(element.id));
    if (added) ui.selectElement(added.id);
  } catch (error) {
    ui.notify('error', error instanceof Error ? error.message : 'The element could not be added.');
  }
}
