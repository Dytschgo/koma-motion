// @vitest-environment jsdom
import type { ImageElement, Koma, KomaElement } from '@koma-motion/core';
import {
  buildKoma,
  buildPresentation,
  buildProject,
  buildShape,
  buildText,
} from '@koma-motion/core/testing';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, type ReactElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { selectCanUndo, selectProject, useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { ElementToolbar } from './ElementToolbar';

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

/** Where the stand-in for each canvas element lies in the window. */
let top = 300;

function elements(koma = 0): readonly KomaElement[] {
  return selectProject(useProjectStore.getState())?.presentation.komas[koma]?.elements ?? [];
}

function stored(id: string): KomaElement {
  const element = elements().find((candidate) => candidate.id === id);
  if (element === undefined) throw new Error(`Element ${id} is not in the document.`);
  return element;
}

/** The scrolling desk with one node per element, as the stage draws them, and the toolbar. */
function Desk(): ReactElement {
  const desk = useRef<HTMLDivElement>(null);
  const project = useProjectStore(selectProject);
  const selectedKomaId = useUiStore((state) => state.selectedKomaId);
  const komas = project?.presentation.komas ?? [];
  const koma = komas.find((candidate) => candidate.id === selectedKomaId) ?? komas[0];
  if (project === null || koma === undefined) return <p>No Koma is open.</p>;
  return (
    <div ref={desk} data-testid="desk">
      {koma.elements.map((element) => (
        <div key={element.id} data-element-id={element.id} />
      ))}
      <ElementToolbar project={project} koma={koma} desk={desk} />
    </div>
  );
}

function open(komas: readonly Koma[], selection: readonly string[]) {
  useProjectStore
    .getState()
    .load(buildProject({ presentation: buildPresentation({ komas: [...komas] }) }), null);
  useUiStore.getState().selectElements(selection);
  return { user: userEvent.setup({ delay: null }), ...render(<Desk />) };
}

const toolbar = () => screen.getByRole('toolbar', { name: 'Element actions' });
const tool = (name: string) => within(toolbar()).getByRole<HTMLButtonElement>('button', { name });
const tools = () =>
  within(toolbar())
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));

async function choose(user: ReturnType<typeof userEvent.setup>, menu: string, item: string) {
  await user.click(tool(menu));
  await user.click(screen.getByRole('menuitem', { name: item }));
}

beforeEach(() => {
  top = 300;
  useUiStore.getState().reset();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      readonly notify: () => void;
      constructor(notify: () => void) {
        this.notify = notify;
      }
      // A browser reports the size once when observation starts.
      observe() {
        this.notify();
      }
      disconnect() {
        /* Nothing was observed. */
      }
    },
  );
  // jsdom has no layout. The desk fills a 1000 x 800 window and every element is 200 x 100.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.hasAttribute('data-element-id')) return new DOMRect(300, top, 200, 100);
    if (this.getAttribute('data-testid') === 'desk') return new DOMRect(0, 0, 1000, 800);
    if (this.getAttribute('role') === 'toolbar') return new DOMRect(0, 0, 320, 40);
    return new DOMRect(0, 0, 0, 0);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('appears beside a selection only, and not while a transition is previewed', () => {
  open([buildKoma()], []);
  expect(screen.queryByRole('toolbar')).toBeNull();

  act(() => useUiStore.getState().selectElement('element-text'));
  expect(toolbar().dataset['side']).toBe('above');

  act(() =>
    useUiStore.setState({
      preview: { transitionId: 'transition-1', fromKomaId: 'koma-1', toKomaId: 'koma-2', token: 1 },
    }),
  );
  expect(screen.queryByRole('toolbar')).toBeNull();
});

it('moves below an element at the top edge and hides while the pointer is down on the canvas', () => {
  top = 4;
  open([buildKoma()], ['element-text']);
  expect(toolbar().dataset['side']).toBe('below');

  const [node] = screen.getByTestId('desk').querySelectorAll('[data-element-id]');
  if (node === undefined) throw new Error('The desk has no element.');
  fireEvent.pointerDown(node);
  expect(screen.queryByRole('toolbar')).toBeNull();
  fireEvent.pointerUp(window);
  expect(toolbar()).toBeTruthy();
});

it('offers the tools that fit the kind of element', () => {
  const { unmount } = open(
    [buildKoma({ elements: [buildText(), buildShape(), image] })],
    ['element-text'],
  );
  expect(tools()).toEqual(['Text colour', 'Size and position', 'Arrange', 'Motion', 'More']);
  expect(tool('Text colour').getAttribute('aria-description')).toBe('#F2EFE9');

  act(() => useUiStore.getState().selectElement('element-image'));
  expect(tools()).toEqual(['Size and position', 'Arrange', 'Motion', 'More']);
  unmount();

  open(
    [
      buildKoma({
        elements: [buildShape({ style: { fill: null, stroke: null, strokeWidth: 0 } })],
      }),
    ],
    ['element-shape'],
  );
  expect(tool('Fill colour').getAttribute('aria-description')).toBe('No fill');
});

it('opens motion for a Koma that has a next Koma, and not for the last one', async () => {
  const { user } = open(
    [buildKoma(), buildKoma({ id: 'koma-2', title: 'Second' })],
    ['element-text'],
  );
  expect(tool('Motion').disabled).toBe(false);
  await user.click(tool('Motion'));
  expect(useUiStore.getState()).toMatchObject({
    inspectorTab: 'motion',
    propertiesOpen: true,
    motionEditing: true,
  });

  act(() => {
    useUiStore.getState().selectKoma('koma-2');
    useUiStore.getState().selectElement('element-text');
  });
  expect(tool('Motion').disabled).toBe(true);
});

it('limits a locked element to unlocking, properties and motion', async () => {
  const { user } = open(
    [buildKoma({ elements: [buildShape(), buildText({ locked: true })] }), buildKoma({ id: 'k2' })],
    ['element-text'],
  );
  expect(
    within(toolbar())
      .getAllByRole<HTMLButtonElement>('button')
      .filter((button) => !button.disabled)
      .map((button) => button.getAttribute('aria-label')),
  ).toEqual(['Motion', 'Unlock element', 'More']);

  await user.click(tool('More'));
  expect(
    screen
      .getAllByRole<HTMLButtonElement>('menuitem')
      .map((item) => `${item.textContent}${item.disabled ? ' (disabled)' : ''}`),
  ).toEqual(['Properties', 'Unlock', 'Hide (disabled)', 'Delete (disabled)']);
  await user.keyboard('{Escape}');

  await user.click(tool('Unlock element'));
  expect(stored('element-text').locked).toBe(false);
  expect(tools()).toEqual(['Text colour', 'Size and position', 'Arrange', 'Motion', 'More']);
  expect(tool('Text colour').disabled).toBe(false);
});

it('moves focus along the enabled tools with the arrow keys and wraps at the ends', async () => {
  const { user } = open([buildKoma()], ['element-text']);
  act(() => tool('Text colour').focus());
  await user.keyboard('{ArrowRight}');
  expect(document.activeElement).toBe(tool('Size and position'));
  // Motion is disabled on the last Koma, so the arrow passes it.
  await user.keyboard('{ArrowRight}{ArrowRight}');
  expect(document.activeElement).toBe(tool('More'));
  await user.keyboard('{ArrowRight}');
  expect(document.activeElement).toBe(tool('Text colour'));
  await user.keyboard('{ArrowLeft}');
  expect(document.activeElement).toBe(tool('More'));
});

it('recolours with Brand Kit swatches as one undo step and returns focus on Escape', async () => {
  const { user } = open([buildKoma()], ['element-text']);
  await user.click(tool('Text colour'));
  const popover = screen.getByRole('dialog', { name: 'Colour' });
  expect(tool('Text colour').getAttribute('aria-expanded')).toBe('true');
  const swatches = within(popover).getAllByRole('button', { pressed: true });
  expect(swatches.map((swatch) => swatch.getAttribute('aria-label'))).toEqual([
    'Use text colour #F2EFE9',
  ]);
  expect(popover.contains(document.activeElement)).toBe(true);

  await user.click(within(popover).getByRole('button', { name: 'Use accent colour #F2C14E' }));
  await user.click(within(popover).getByRole('button', { name: 'Use primary colour #FF5A36' }));
  expect(stored('element-text')).toMatchObject({ style: { colour: '#FF5A36' } });
  expect(
    within(popover).getByRole('button', { name: 'Use primary colour #FF5A36', pressed: true }),
  ).toBeTruthy();

  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(tool('Text colour'));

  act(() => useProjectStore.getState().undo());
  expect(stored('element-text')).toMatchObject({ style: { colour: '#F2EFE9' } });
  expect(selectCanUndo(useProjectStore.getState())).toBe(false);
});

it('gives a shape without a fill a fill, and leads from the colours to the Brand Kit', async () => {
  const { user } = open(
    [
      buildKoma({
        elements: [buildShape({ style: { fill: null, stroke: null, strokeWidth: 0 } })],
      }),
    ],
    ['element-shape'],
  );
  await user.click(tool('Fill colour'));
  const popover = screen.getByRole('dialog', { name: 'Colour' });
  expect(within(popover).queryByRole('button', { pressed: true })).toBeNull();
  await user.click(within(popover).getByRole('button', { name: 'Use secondary colour #2B3A55' }));
  expect(stored('element-shape')).toMatchObject({ style: { fill: '#2B3A55' } });

  await user.click(within(popover).getByRole('button', { name: 'Edit Brand Kit' }));
  expect(useUiStore.getState()).toMatchObject({ view: 'brandKit', propertiesOpen: true });
});

it('resizes from the size panel and closes the panel when the selection changes', async () => {
  const { user } = open([buildKoma()], ['element-text']);
  await user.click(tool('Size and position'));
  const popover = screen.getByRole('dialog', { name: 'Size and position' });
  const height = within(popover).getByRole<HTMLInputElement>('textbox', { name: 'Height' });
  expect(height.value).toBe('120');
  await user.clear(height);
  await user.type(height, '240');
  expect(stored('element-text').size).toEqual({ width: 800, height: 240 });

  act(() => useUiStore.getState().selectElement('element-shape'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(tool('Size and position').getAttribute('aria-expanded')).toBe('false');
});

it('groups several elements, then offers to ungroup the group it selected', async () => {
  const { user } = open([buildKoma()], ['element-shape', 'element-text']);
  expect(tools()).toEqual(['Group selected elements', 'More']);
  await user.click(tool('Group selected elements'));

  const [created] = elements();
  expect(elements()).toHaveLength(1);
  expect(created?.type).toBe('group');
  expect(useUiStore.getState().selectedElementIds).toEqual([created?.id]);

  await user.click(tool('Ungroup selected group'));
  expect(elements().map((element) => element.type)).toEqual(['shape', 'text']);
  expect(useUiStore.getState().selectedElementIds).toHaveLength(2);
  expect(tool('Group selected elements').disabled).toBe(false);
});

it('does not offer to group a selection that contains a locked element', () => {
  open(
    [buildKoma({ elements: [buildShape({ locked: true }), buildText()] })],
    ['element-shape', 'element-text'],
  );
  expect(tool('Group selected elements').disabled).toBe(true);
  expect(tool('Group selected elements').title).toBe('These elements cannot be grouped');
});

it('restacks from Arrange and disables the moves that have nowhere to go', async () => {
  const { user } = open([buildKoma()], ['element-text']);
  await user.click(tool('Arrange'));
  expect(
    screen
      .getAllByRole<HTMLButtonElement>('menuitem')
      .map((item) => `${item.textContent}${item.disabled ? ' (disabled)' : ''}`),
  ).toEqual([
    'Bring to front (disabled)',
    'Bring forward (disabled)',
    'Send backward',
    'Send to back',
  ]);
  await user.click(screen.getByRole('menuitem', { name: 'Send to back' }));
  expect(screen.queryByRole('menu')).toBeNull();
  expect(stored('element-text').zIndex).toBeLessThan(stored('element-shape').zIndex);

  await choose(user, 'Arrange', 'Bring to front');
  expect(stored('element-text').zIndex).toBeGreaterThan(stored('element-shape').zIndex);
});

it('hides, opens properties and deletes from More', async () => {
  const { user } = open([buildKoma()], ['element-text']);
  await choose(user, 'More', 'Hide');
  expect(stored('element-text').visible).toBe(false);
  await user.click(tool('More'));
  expect(screen.getByRole('menuitem', { name: 'Show' })).toBeTruthy();
  await user.click(screen.getByRole('menuitem', { name: 'Properties' }));
  expect(useUiStore.getState()).toMatchObject({ propertiesOpen: true, inspectorTab: 'element' });

  await choose(user, 'More', 'Delete');
  expect(elements().map((element) => element.id)).toEqual(['element-shape']);
  expect(useUiStore.getState().selectedElementIds).toEqual([]);
  expect(screen.queryByRole('toolbar')).toBeNull();
});
