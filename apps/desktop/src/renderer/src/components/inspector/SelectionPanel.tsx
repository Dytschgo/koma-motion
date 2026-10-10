import { checkGroupable, type Koma } from '@koma-motion/core';
import type { ReactElement } from 'react';
import { groupSelection } from '../../lib/groupActions';
import { getLayerName } from '../../lib/layers';
import { useUiStore } from '../../state/uiStore';
import { Button } from '../ui';
import { ElementTypeIcon } from './LayersPanel';

/** Several selected elements: what they are, and grouping them. */
export function SelectionPanel({
  koma,
  selection,
}: {
  readonly koma: Koma;
  readonly selection: readonly string[];
}): ReactElement {
  const selectElement = useUiStore((state) => state.selectElement);
  const elements = koma.elements.filter((element) => selection.includes(element.id));
  const problem = checkGroupable(koma, selection);
  return (
    <div className="flex flex-col gap-2 px-3 pt-2 pb-3">
      <h2 className="text-base font-semibold text-ink-100">{elements.length} elements selected</h2>
      <ul aria-label="Selected elements" className="flex flex-col gap-0.5">
        {elements.map((element) => (
          <li key={element.id} className="flex min-w-0 items-center gap-2 text-ink-300">
            <span aria-hidden="true" className="flex-none text-ink-400">
              <ElementTypeIcon element={element} />
            </span>
            <span className="truncate">{getLayerName(element)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={problem !== null}
          onClick={() => {
            groupSelection();
          }}
        >
          Group
        </Button>
        <Button
          onClick={() => {
            selectElement(null);
          }}
        >
          Clear selection
        </Button>
      </div>
      <p className="text-sm text-ink-400">
        {problem?.message ??
          'Ctrl/Command+G groups them. Shift-click or Ctrl/Command-click adds or removes an element.'}
      </p>
    </div>
  );
}
