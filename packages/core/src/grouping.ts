/**
 * Grouping and ungrouping elements of one Koma. Pure document operations:
 * they return a new Koma and leave their input untouched.
 *
 * Both operations keep what the Koma looks like at rest:
 *
 * - Grouping keeps every child where it was drawn. The group's box is the
 *   bounding box of the drawn (rotated) children, with `referenceSize` equal
 *   to its size, so children are not scaled. The group takes the stacking
 *   place of its frontmost child; the children keep their order within it.
 * - Ungrouping converts each child back to canvas coordinates, applying the
 *   group's scale, rotation and opacity, and puts the children in the
 *   group's stacking place.
 *
 * Children keep their `id` and `persistentId`. The group's `persistentId` is
 * derived from the persistent ids of its children, so grouping the same
 * objects on another Koma gives the same group identity and the group moves
 * as one object between those Komas. See docs/MOTION_MODEL.md.
 */
import { hashString, type IdGenerator } from './ids';
import { err, ok, type Result } from './result';
import {
  MAX_GROUP_CHILDREN,
  type GroupElement,
  type KomaElement,
  type LeafElement,
} from './schema/element';
import { collectElementIdentities, komaSchema, type Koma } from './schema/koma';

export type GroupingErrorCode =
  | 'tooFewElements'
  | 'tooManyElements'
  | 'missingElement'
  | 'containsGroup'
  | 'locked'
  | 'notAGroup'
  | 'invalidResult';

export interface GroupingError {
  readonly code: GroupingErrorCode;
  readonly message: string;
}

export interface GroupResult {
  readonly koma: Koma;
  readonly group: GroupElement;
}

export interface UngroupResult {
  readonly koma: Koma;
  /** The former children, in canvas coordinates, back to front. */
  readonly children: readonly LeafElement[];
}

/** Coordinates are rounded to this many decimals to avoid floating point noise. */
const PRECISION = 1e6;

function round(value: number): number {
  const rounded = Math.round(value * PRECISION) / PRECISION;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function failure(code: GroupingErrorCode, message: string): { ok: false; error: GroupingError } {
  return err({ code, message });
}

/** Elements in drawing order, back to front: by layer number, then document order. */
export function sortBackToFront<T extends { readonly zIndex: number }>(
  elements: readonly T[],
): T[] {
  return elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => a.element.zIndex - b.element.zIndex || a.index - b.index)
    .map((item) => item.element);
}

/**
 * The persistent identity of a group of objects: the same set of objects
 * always gives the same identity, in any order and on any Koma.
 */
export function derivePersistentGroupId(childPersistentIds: readonly string[]): string {
  const key = [...childPersistentIds].sort().join('\n');
  return `group_${hashString(`koma-motion/group/${key}`)}`;
}

function uniquePersistentId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${String(suffix)}`;
    if (!taken.has(candidate)) return candidate;
  }
}

interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The axis-aligned box an element covers when it is drawn with its rotation. */
function drawnBounds(element: KomaElement): Bounds {
  const angle = (element.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const { width, height } = element.size;
  // Exact for the common unrotated case, without trigonometric noise.
  const halfWidth = element.rotation % 180 === 0 ? width / 2 : (width * cos + height * sin) / 2;
  const halfHeight = element.rotation % 180 === 0 ? height / 2 : (width * sin + height * cos) / 2;
  const centreX = element.position.x + width / 2;
  const centreY = element.position.y + height / 2;
  return {
    left: centreX - halfWidth,
    top: centreY - halfHeight,
    right: centreX + halfWidth,
    bottom: centreY + halfHeight,
  };
}

function validateResult(koma: Koma): GroupingError | null {
  const parsed = komaSchema.safeParse(koma);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  return {
    code: 'invalidResult',
    message: `The result would not be a valid Koma: ${issue?.message ?? 'unknown problem'}.`,
  };
}

/** Why the elements cannot be grouped, or `null` when they can. */
export function checkGroupable(koma: Koma, elementIds: readonly string[]): GroupingError | null {
  const unique = [...new Set(elementIds)];
  if (unique.length < 2) {
    return { code: 'tooFewElements', message: 'Select two or more elements to group them.' };
  }
  if (unique.length > MAX_GROUP_CHILDREN) {
    return {
      code: 'tooManyElements',
      message: `A group can contain up to ${String(MAX_GROUP_CHILDREN)} elements.`,
    };
  }
  for (const id of unique) {
    const element = koma.elements.find((candidate) => candidate.id === id);
    if (element === undefined) {
      return {
        code: 'missingElement',
        message: 'Only elements directly on the same Koma can be grouped.',
      };
    }
    if (element.type === 'group') {
      return {
        code: 'containsGroup',
        message: 'Groups cannot contain other groups. Ungroup it first.',
      };
    }
    if (element.locked) {
      return { code: 'locked', message: 'Unlock the selected elements before grouping them.' };
    }
  }
  return null;
}

/**
 * Puts the top-level elements `elementIds` of `koma` into one new group.
 * Nothing is drawn differently afterwards, except that elements between the
 * grouped ones in the stacking order now lie behind the whole group.
 */
export function groupElements(
  koma: Koma,
  elementIds: readonly string[],
  idGenerator: IdGenerator,
  options: { readonly name?: string } = {},
): Result<GroupResult, GroupingError> {
  const problem = checkGroupable(koma, elementIds);
  if (problem !== null) return err(problem);
  const selected = new Set(elementIds);
  const members = sortBackToFront(
    koma.elements.filter((element) => selected.has(element.id)),
  ).filter((element): element is LeafElement => element.type !== 'group');
  const frontmost = members.at(-1);
  if (frontmost === undefined || members.length < 2) {
    return failure('tooFewElements', 'Select two or more elements to group them.');
  }

  const bounds = members.map(drawnBounds).reduce((all, next) => ({
    left: Math.min(all.left, next.left),
    top: Math.min(all.top, next.top),
    right: Math.max(all.right, next.right),
    bottom: Math.max(all.bottom, next.bottom),
  }));
  const origin = { x: round(bounds.left), y: round(bounds.top) };
  const size = {
    width: round(bounds.right - bounds.left),
    height: round(bounds.bottom - bounds.top),
  };
  const children = members.map((child): LeafElement => ({
    ...child,
    position: { x: round(child.position.x - origin.x), y: round(child.position.y - origin.y) },
  }));

  const taken = new Set(
    collectElementIdentities(koma.elements)
      .filter((identity) => !selected.has(identity.id))
      .map((identity) => identity.persistentId),
  );
  const group: GroupElement = {
    id: idGenerator.next('element'),
    persistentId: uniquePersistentId(
      derivePersistentGroupId(members.map((member) => member.persistentId)),
      taken,
    ),
    name: options.name ?? 'Group',
    type: 'group',
    position: origin,
    size,
    rotation: 0,
    opacity: 1,
    zIndex: frontmost.zIndex,
    locked: false,
    visible: true,
    content: { referenceSize: size, children },
    style: {},
  };

  // The group takes the document position of its frontmost child, so it is
  // drawn exactly where that child was among elements of the same layer.
  const elements = koma.elements.flatMap((element) =>
    element.id === frontmost.id ? [group] : selected.has(element.id) ? [] : [element],
  );
  const next: Koma = { ...koma, elements };
  const invalid = validateResult(next);
  return invalid === null ? ok({ koma: next, group }) : err(invalid);
}

function scaleLength(value: number, factor: number): number {
  return round(value * factor);
}

/** A child of `group` as a top-level element, drawn where the group drew it. */
function toCanvasElement(group: GroupElement, child: LeafElement): LeafElement {
  const { referenceSize } = group.content;
  const scaleX = group.size.width / referenceSize.width;
  const scaleY = group.size.height / referenceSize.height;
  const width = child.size.width * scaleX;
  const height = child.size.height * scaleY;
  const pivotX = group.position.x + group.size.width / 2;
  const pivotY = group.position.y + group.size.height / 2;
  const offsetX = group.position.x + (child.position.x + child.size.width / 2) * scaleX - pivotX;
  const offsetY = group.position.y + (child.position.y + child.size.height / 2) * scaleY - pivotY;
  const angle = (group.rotation * Math.PI) / 180;
  const cos = group.rotation % 360 === 0 ? 1 : Math.cos(angle);
  const sin = group.rotation % 360 === 0 ? 0 : Math.sin(angle);
  const centreX = pivotX + offsetX * cos - offsetY * sin;
  const centreY = pivotY + offsetX * sin + offsetY * cos;
  // Lengths inside the content (font size, stroke, radius) scale with the
  // group. With unequal scaling the smaller factor keeps text inside its box.
  const factor = Math.min(scaleX, scaleY);
  const base = {
    position: { x: round(centreX - width / 2), y: round(centreY - height / 2) },
    size: { width: round(width), height: round(height) },
    rotation: round(group.rotation + child.rotation),
    opacity: round(group.opacity * child.opacity),
    visible: group.visible && child.visible,
  };
  if (factor === 1) return { ...child, ...base };
  switch (child.type) {
    case 'text':
      return {
        ...child,
        ...base,
        style: { ...child.style, fontSize: scaleLength(child.style.fontSize, factor) },
      };
    case 'shape':
      return {
        ...child,
        ...base,
        content: {
          ...child.content,
          cornerRadius: scaleLength(child.content.cornerRadius, factor),
        },
        style: { ...child.style, strokeWidth: scaleLength(child.style.strokeWidth, factor) },
      };
    case 'image':
      return {
        ...child,
        ...base,
        style: { ...child.style, cornerRadius: scaleLength(child.style.cornerRadius, factor) },
      };
  }
}

/** The ids of `elements` in drawing order. */
function paintOrder(elements: readonly KomaElement[]): string[] {
  return sortBackToFront(elements).map((element) => element.id);
}

/**
 * Replaces the group `groupId` with its children, drawn where the group drew
 * them and in the group's place in the stacking order. Children keep their
 * own layer numbers when that keeps this order; otherwise they take the
 * group's layer number.
 */
export function ungroupElement(koma: Koma, groupId: string): Result<UngroupResult, GroupingError> {
  const group = koma.elements.find((element) => element.id === groupId);
  if (group === undefined) {
    return failure('missingElement', 'The group is no longer on this Koma.');
  }
  if (group.type !== 'group') {
    return failure('notAGroup', 'Select a group to ungroup it.');
  }
  if (group.locked) {
    return failure('locked', 'Unlock the group before ungrouping it.');
  }
  const converted = sortBackToFront(group.content.children).map((child) =>
    toCanvasElement(group, child),
  );
  const place = (children: readonly LeafElement[]): KomaElement[] =>
    koma.elements.flatMap((element): KomaElement[] =>
      element.id === groupId ? [...children] : [element],
    );

  const expected = sortBackToFront(koma.elements).flatMap((element) =>
    element.id === groupId ? converted.map((child) => child.id) : [element.id],
  );
  const ownLayers = place(converted);
  const elements =
    JSON.stringify(paintOrder(ownLayers)) === JSON.stringify(expected)
      ? ownLayers
      : place(converted.map((child) => ({ ...child, zIndex: group.zIndex })));
  const children = elements.filter(
    (element): element is LeafElement =>
      element.type !== 'group' && converted.some((child) => child.id === element.id),
  );
  const next: Koma = { ...koma, elements };
  const invalid = validateResult(next);
  return invalid === null ? ok({ koma: next, children }) : err(invalid);
}
