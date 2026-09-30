/**
 * The layer list of a Koma: stacking order, readable names and where an
 * element sits relative to the canvas. Pure functions, so that the rules can
 * be tested without a window.
 */
import type { KomaElement, Size } from '@koma-motion/core';

/** Elements with the same layer number are drawn in document order, later in front. */
function compareBackToFront(
  a: { readonly element: KomaElement; readonly index: number },
  b: { readonly element: KomaElement; readonly index: number },
): number {
  return a.element.zIndex - b.element.zIndex || a.index - b.index;
}

function backToFront(elements: readonly KomaElement[]): KomaElement[] {
  return elements
    .map((element, index) => ({ element, index }))
    .sort(compareBackToFront)
    .map((item) => item.element);
}

/** The elements as the layer list shows them: the frontmost first. */
export function orderLayers(elements: readonly KomaElement[]): KomaElement[] {
  return backToFront(elements).reverse();
}

export type StackMove = 'forward' | 'backward' | 'front' | 'back';

const MIN_LAYER = -10000;
const MAX_LAYER = 10000;

/**
 * Moves one element in the stacking order and returns the elements in their
 * document order with new layer numbers. Elements whose number does not
 * change keep their identity. Returns `elements` itself when nothing moves.
 */
export function restackElements(
  elements: readonly KomaElement[],
  elementId: string,
  move: StackMove,
): readonly KomaElement[] {
  const ordered = backToFront(elements);
  const from = ordered.findIndex((element) => element.id === elementId);
  if (from === -1) {
    return elements;
  }
  const last = ordered.length - 1;
  const to =
    move === 'forward'
      ? Math.min(last, from + 1)
      : move === 'backward'
        ? Math.max(0, from - 1)
        : move === 'front'
          ? last
          : 0;
  if (to === from) {
    return elements;
  }
  const [moved] = ordered.splice(from, 1);
  if (moved === undefined) {
    return elements;
  }
  ordered.splice(to, 0, moved);

  // Distinct numbers can be handed out again in the new order: only the
  // elements between the old and the new place change. Equal numbers are
  // replaced with consecutive ones, because document order would otherwise decide.
  const numbers = elements.map((element) => element.zIndex).sort((a, b) => a - b);
  const distinct = new Set(numbers).size === numbers.length;
  const lowest = Math.min(Math.max(MIN_LAYER, numbers[0] ?? 0), MAX_LAYER - (ordered.length - 1));
  const layerOf = new Map(
    ordered.map((element, rank) => [
      element.id,
      distinct ? (numbers[rank] ?? element.zIndex) : lowest + rank,
    ]),
  );
  return elements.map((element) => {
    const zIndex = layerOf.get(element.id) ?? element.zIndex;
    return zIndex === element.zIndex ? element : { ...element, zIndex };
  });
}

export type CanvasPlacement = 'inside' | 'partly' | 'outside';

/** Where the unrotated box of an element lies relative to the canvas. */
export function getCanvasPlacement(element: KomaElement, canvas: Size): CanvasPlacement {
  const left = element.position.x;
  const top = element.position.y;
  const right = left + element.size.width;
  const bottom = top + element.size.height;
  if (right <= 0 || bottom <= 0 || left >= canvas.width || top >= canvas.height) {
    return 'outside';
  }
  if (left < 0 || top < 0 || right > canvas.width || bottom > canvas.height) {
    return 'partly';
  }
  return 'inside';
}

const TYPE_LABELS: Readonly<Record<KomaElement['type'], string>> = {
  text: 'Text',
  shape: 'Shape',
  image: 'Image',
  group: 'Group',
};

const SHAPE_LABELS = {
  rectangle: 'Rectangle',
  roundedRectangle: 'Rounded rectangle',
  circle: 'Circle',
  line: 'Line',
} as const;

export function getTypeLabel(element: KomaElement): string {
  return TYPE_LABELS[element.type];
}

/** A short description of what the element is, for the second line of a layer. */
export function describeElementKind(element: KomaElement): string {
  switch (element.type) {
    case 'shape':
      return SHAPE_LABELS[element.content.shape];
    case 'group':
      return `Group of ${String(element.content.children.length)}`;
    default:
      return TYPE_LABELS[element.type];
  }
}

/** The name shown for an element. Unnamed elements are described by their content. */
export function getLayerName(element: KomaElement): string {
  const name = element.name.trim();
  if (name !== '') {
    return name;
  }
  if (element.type === 'text') {
    const text = element.content.text.trim().replace(/\s+/g, ' ');
    if (text !== '') {
      return text.length > 40 ? `${text.slice(0, 40)}…` : text;
    }
  }
  return `Untitled ${describeElementKind(element).toLowerCase()}`;
}

/** Layers whose name, kind or text contains the query, ignoring case. */
export function filterLayers(
  elements: readonly KomaElement[],
  query: string,
): readonly KomaElement[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return elements;
  }
  return elements.filter((element) => {
    const haystack = [
      getLayerName(element),
      describeElementKind(element),
      element.type === 'text' ? element.content.text : '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

/** Rows rendered at once. Longer lists grow in steps, so a Koma at its element limit stays responsive. */
export const LAYER_PAGE_SIZE = 100;
/** From this many elements, the layer list offers a filter. */
export const LAYER_FILTER_THRESHOLD = 8;
