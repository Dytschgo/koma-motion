// @vitest-environment jsdom
import type { GroupElement, ImageElement, KomaElement, KomaProject } from '@koma-motion/core';
import {
  buildKoma,
  buildPresentation,
  buildProject,
  buildShape,
  buildText,
} from '@koma-motion/core/testing';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { chooseKomaImage } from '../../lib/projectActions';
import { selectCanUndo, selectProject, useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { ElementPanel } from './ElementPanel';

vi.mock('../../lib/projectActions', () => ({ chooseKomaImage: vi.fn() }));

const image: ImageElement = {
  id: 'element-image',
  persistentId: 'image',
  name: 'Photo',
  type: 'image',
  position: { x: 0, y: 0 },
  size: { width: 400, height: 300 },
  rotation: 0,
  opacity: 1,
  zIndex: 3,
  locked: false,
  visible: true,
  content: { assetId: 'asset-photo', altText: '' },
  style: { fit: 'contain', cornerRadius: 0 },
};

const group: GroupElement = {
  id: 'element-group',
  persistentId: 'group',
  name: 'Card',
  type: 'group',
  position: { x: 200, y: 200 },
  size: { width: 400, height: 300 },
  rotation: 0,
  opacity: 1,
  zIndex: 3,
  locked: false,
  visible: true,
  content: {
    referenceSize: { width: 400, height: 300 },
    children: [
      buildShape({ id: 'child-shape', persistentId: 'child-shape', name: 'Backdrop' }),
      buildText({
        id: 'child-text',
        persistentId: 'child-text',
        name: '',
        content: { text: 'Quarterly results' },
      }),
    ],
  },
  style: {},
};

function elements(): readonly KomaElement[] {
  return selectProject(useProjectStore.getState())?.presentation.komas[0]?.elements ?? [];
}

/** The element as the document holds it now. */
function stored(id: string): KomaElement {
  const element = elements().find((candidate) => candidate.id === id);
  if (element === undefined) throw new Error(`Element ${id} is not in the document.`);
  return element;
}

/** Shows the panel the way the Inspector does: for the open project, and again after each change. */
function Panel({ elementId }: { readonly elementId: string }): ReactElement {
  const project = useProjectStore(selectProject);
  const koma = project?.presentation.komas[0];
  const element = koma?.elements.find((candidate) => candidate.id === elementId);
  if (project === null || koma === undefined || element === undefined) {
    return <p>The element is gone.</p>;
  }
  return <ElementPanel project={project} koma={koma} element={element} />;
}

function open(
  elementId: string,
  kept: readonly KomaElement[],
  overrides: Partial<KomaProject> = {},
) {
  useProjectStore.getState().load(
    buildProject({
      presentation: buildPresentation({ komas: [buildKoma({ elements: [...kept] })] }),
      ...overrides,
    }),
    null,
  );
  useUiStore.getState().selectElement(elementId);
  return { user: userEvent.setup({ delay: null }), ...render(<Panel elementId={elementId} />) };
}

const field = (name: string) => screen.getByRole<HTMLInputElement>('textbox', { name });
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });

beforeEach(() => {
  useUiStore.getState().reset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('edits text and geometry, and keeps one field typed in one go as a single undo step', async () => {
  const { user } = open('element-text', [buildShape(), buildText()]);
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Selected element: Text');

  await user.clear(field('X'));
  await user.type(field('X'), '250');
  expect(stored('element-text').position).toEqual({ x: 250, y: 400 });
  act(() => useProjectStore.getState().undo());
  expect(stored('element-text').position).toEqual({ x: 100, y: 400 });
  expect(selectCanUndo(useProjectStore.getState())).toBe(false);

  // Another field is another step, so Undo takes back one property at a time.
  await user.type(field('Text'), ' Make them move.');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Alignment' }), 'center');
  expect(stored('element-text')).toMatchObject({
    content: { text: 'Presentations are frames. Make them move.' },
    style: { textAlign: 'center' },
  });
  act(() => useProjectStore.getState().undo());
  expect(stored('element-text')).toMatchObject({
    content: { text: 'Presentations are frames. Make them move.' },
    style: { textAlign: 'left' },
  });
});

it('names an unnamed text element by its content', async () => {
  const { user } = open('element-text', [buildText()]);
  await user.clear(field('Name'));
  expect(stored('element-text').name).toBe('');
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
    'Selected element: Presentations are frames.',
  );
});

it('keeps unfinished and out-of-range numbers out of the document and restores the field', async () => {
  const { user } = open('element-text', [buildText()]);
  const width = field('Width');
  await user.clear(width);
  await user.type(width, '0');
  await user.clear(width);
  await user.type(width, 'wide');
  expect(width.value).toBe('wide');
  expect(stored('element-text').size).toEqual({ width: 800, height: 120 });
  expect(selectCanUndo(useProjectStore.getState())).toBe(false);

  await user.tab();
  expect(width.value).toBe('800');

  // A decimal comma is accepted, as on a German keyboard.
  await user.clear(width);
  await user.type(width, '640,5');
  expect(stored('element-text').size.width).toBe(640.5);
});

it('shows opacity in percent and stores it as a fraction', async () => {
  const { user } = open('element-text', [buildText({ opacity: 0.25 })]);
  const opacity = field('Opacity in percent');
  expect(opacity.value).toBe('25');
  await user.clear(opacity);
  await user.type(opacity, '80');
  expect(stored('element-text').opacity).toBe(0.8);
  await user.clear(opacity);
  await user.type(opacity, '101');
  expect(stored('element-text').opacity).toBe(0.1);
});

it('marks a number field as invalid while its text is not a usable number, and clears the mark', async () => {
  const { user } = open('element-text', [buildText()]);
  await user.clear(field('Width'));
  expect(field('Width').getAttribute('aria-invalid')).toBe('true');
  await user.type(field('Width'), '300');
  expect(field('Width').getAttribute('aria-invalid')).toBeNull();
});

it('rejects a colour that is not a hex value and stores a valid one', async () => {
  const { user } = open('element-text', [buildText()]);
  const colour = field('Text colour');
  await user.clear(colour);
  await user.type(colour, 'tomato');
  expect(screen.getByRole('alert').textContent).toBe(
    'Error: Choose a colour or enter a hex value.',
  );
  expect(stored('element-text')).toMatchObject({ style: { colour: '#F2EFE9' } });

  await user.clear(colour);
  await user.type(colour, '#00aa11');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(stored('element-text')).toMatchObject({ style: { colour: '#00AA11' } });
});

it('disables every editing control of a locked element except Unlock', async () => {
  const { user, container } = open('element-shape', [buildShape({ locked: true }), buildText()]);
  const enabled = () =>
    [
      ...container.querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >('button, input, select, textarea'),
    ]
      .filter((control) => !control.disabled)
      .map((control) => control.getAttribute('aria-label'));
  expect(enabled()).toEqual(['Unlock element']);
  expect(screen.getByText('Unlock to edit.')).toBeTruthy();
  expect(screen.getByText('Locked')).toBeTruthy();

  await user.click(button('Unlock element'));
  expect(stored('element-shape').locked).toBe(false);
  expect(screen.queryByText('Unlock to edit.')).toBeNull();
  expect(button('Lock element').disabled).toBe(false);
  expect(button('Delete element').disabled).toBe(false);
  expect(field('X').disabled).toBe(false);
});

it('moves an element through the stack and stops at both ends', async () => {
  const { user } = open('element-text', [buildShape(), buildText()]);
  expect(screen.getByText('Layer 1 of 2')).toBeTruthy();
  expect(button('Bring forward').disabled).toBe(true);

  await user.click(button('Send backward'));
  expect(screen.getByText('Layer 2 of 2')).toBeTruthy();
  expect(button('Send backward').disabled).toBe(true);
  expect(stored('element-text').zIndex).toBeLessThan(stored('element-shape').zIndex);

  await user.click(button('Bring forward'));
  expect(screen.getByText('Layer 1 of 2')).toBeTruthy();
  expect(stored('element-text').zIndex).toBeGreaterThan(stored('element-shape').zIndex);
});

it('reports a hidden element that lies off the canvas and shows it again', async () => {
  const { user } = open('element-text', [
    buildText({ visible: false, position: { x: -5000, y: 0 } }),
  ]);
  expect(screen.getByText('Hidden')).toBeTruthy();
  expect(screen.getByText('Off the canvas')).toBeTruthy();
  await user.click(button('Show element'));
  expect(stored('element-text').visible).toBe(true);
  expect(screen.queryByText('Hidden')).toBeNull();
  expect(button('Hide element')).toBeTruthy();
});

it('switches fill and outline on with Brand Kit colours and a visible outline width', async () => {
  const { user } = open('element-shape', [
    buildShape({ style: { fill: null, stroke: null, strokeWidth: 0 } }),
  ]);
  expect(screen.queryByRole('textbox', { name: 'Fill colour' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Outline width' })).toBeNull();

  await user.click(screen.getByRole('checkbox', { name: 'Fill' }));
  await user.click(screen.getByRole('checkbox', { name: 'Outline' }));
  expect(stored('element-shape')).toMatchObject({
    style: { fill: '#FF5A36', stroke: '#F2EFE9', strokeWidth: 4 },
  });
  expect(field('Fill colour').value).toBe('#FF5A36');
  expect(field('Outline width').value).toBe('4');

  // Switching the outline off and on keeps a width the person chose.
  await user.clear(field('Outline width'));
  await user.type(field('Outline width'), '9');
  await user.click(screen.getByRole('checkbox', { name: 'Outline' }));
  expect(stored('element-shape')).toMatchObject({ style: { stroke: null, strokeWidth: 9 } });
  await user.click(screen.getByRole('checkbox', { name: 'Outline' }));
  expect(stored('element-shape')).toMatchObject({ style: { stroke: '#F2EFE9', strokeWidth: 9 } });
});

it('offers a corner radius for rounded rectangles only', async () => {
  const { user } = open('element-shape', [buildShape()]);
  expect(screen.queryByRole('textbox', { name: 'Corner radius' })).toBeNull();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Shape' }), 'Rounded rectangle');
  await user.clear(field('Corner radius'));
  await user.type(field('Corner radius'), '24');
  expect(stored('element-shape')).toMatchObject({
    content: { shape: 'roundedRectangle', cornerRadius: 24 },
  });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Shape' }), 'Line');
  expect(screen.queryByRole('textbox', { name: 'Corner radius' })).toBeNull();
});

it('names the file of an image, warns when it is missing and replaces it for this element', async () => {
  const { user, unmount } = open('element-image', [image], {
    assets: [
      {
        id: 'asset-photo',
        type: 'image',
        name: 'team.png',
        mediaType: 'image/png',
        projectPath: 'assets/team.png',
        metadata: {},
        embeddedData: null,
      },
    ],
  });
  expect(screen.getByText('team.png')).toBeTruthy();
  expect(screen.queryByText('The image file is missing.')).toBeNull();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Fit' }), 'Fill and crop');
  await user.type(field('Description for screen readers'), 'The team');
  expect(stored('element-image')).toMatchObject({
    content: { altText: 'The team' },
    style: { fit: 'cover' },
  });
  await user.click(button('Replace image'));
  expect(chooseKomaImage).toHaveBeenCalledExactlyOnceWith('koma-1', 'element-image');
  unmount();

  open('element-image', [image]);
  expect(screen.getByText('The image file is missing.')).toBeTruthy();
  expect(button('Replace image').disabled).toBe(false);
});

it('lists the children of a group and ungroups it into a selection of them', async () => {
  const { user } = open('element-group', [group]);
  expect(screen.getByText('This group contains 2 elements.')).toBeTruthy();
  expect(
    [...screen.getByRole('list', { name: 'Elements in this group' }).children].map(
      (item) => item.textContent,
    ),
  ).toEqual(['Backdrop', 'Quarterly results']);

  await user.click(button('Ungroup'));
  expect(elements().map((element) => element.id)).toEqual(['child-shape', 'child-text']);
  expect(useUiStore.getState().selectedElementIds).toEqual(['child-shape', 'child-text']);
  act(() => useProjectStore.getState().undo());
  expect(elements().map((element) => element.id)).toEqual(['element-group']);
});

it('deletes the element and leaves nothing selected', async () => {
  const { user } = open('element-shape', [buildShape(), buildText()]);
  await user.click(button('Delete element'));
  expect(elements().map((element) => element.id)).toEqual(['element-text']);
  expect(useUiStore.getState()).toMatchObject({
    selectedElementId: null,
    selectedElementIds: [],
    inspectorTab: 'koma',
  });
});
