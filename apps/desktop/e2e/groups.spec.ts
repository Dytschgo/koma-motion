import { createSeededIdGenerator, komaProjectSchema } from '@koma-motion/core';
import {
  buildKoma,
  buildPresentation,
  buildProject,
  buildShape,
  buildText,
} from '@koma-motion/core/testing';
import { syncTransitions } from '@koma-motion/motion-engine';
import { serialiseProject } from '@koma-motion/project-format';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import {
  answerOpenDialog,
  answerSaveDialog,
  launchApplication,
  showInspector,
  type RunningApplication,
} from './application';

let running: RunningApplication;
test.beforeEach(async () => {
  running = await launchApplication();
});
test.afterEach(async () => {
  await running.close();
});

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where objects are drawn, in logical canvas units, so that a change of zoom does not matter. */
async function drawnBoxes(locators: readonly Locator[]): Promise<Box[]> {
  const canvas = await stage().boundingBox();
  if (canvas === null) throw new Error('The canvas is not drawn');
  const unit = 1920 / canvas.width;
  const boxes: Box[] = [];
  for (const locator of locators) {
    const box = await locator.boundingBox();
    if (box === null) throw new Error('An object is not drawn');
    boxes.push({
      x: (box.x - canvas.x) * unit,
      y: (box.y - canvas.y) * unit,
      width: box.width * unit,
      height: box.height * unit,
    });
  }
  return boxes;
}

function expectSameBoxes(actual: readonly Box[], expected: readonly Box[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((box, index) => {
    const other = expected[index];
    if (other === undefined) throw new Error('Missing box');
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(box[key] - other[key]), `${key} of object ${String(index)}`).toBeLessThan(2);
    }
  });
}

function stage() {
  return running.window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');
}

const badge = buildShape({
  id: 'badge-1',
  persistentId: 'badge',
  name: 'Badge',
  position: { x: 100, y: 100 },
  size: { width: 200, height: 200 },
  zIndex: 1,
});
const caption = buildText({
  id: 'caption-1',
  persistentId: 'caption',
  name: 'Caption',
  position: { x: 100, y: 400 },
  size: { width: 800, height: 120 },
  zIndex: 2,
});
const marker = buildShape({
  id: 'marker-1',
  persistentId: 'marker',
  name: 'Marker',
  position: { x: 1300, y: 600 },
  size: { width: 240, height: 240 },
  zIndex: 3,
  content: { shape: 'rectangle', cornerRadius: 0 },
});

test('groups selected elements, ungroups them, and keeps groups through undo, redo and reopening', async () => {
  const { window, application, directory } = running;
  // The small window used on CI runners: the Inspector replaces the chat.
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 668);
  });
  const first = buildKoma({ id: 'koma-1', title: 'Grouping', elements: [badge, caption, marker] });
  const second = buildKoma({
    id: 'koma-2',
    title: 'Next state',
    elements: [
      { ...badge, id: 'badge-2' },
      { ...caption, id: 'caption-2' },
      { ...marker, id: 'marker-2' },
    ],
  });
  const project = buildProject({
    name: 'Grouping fixture',
    presentation: syncTransitions(
      buildPresentation({ komas: [first, second], transitions: [] }),
      createSeededIdGenerator('groups-e2e'),
    ).presentation,
  });
  const encoded = serialiseProject(project);
  if (!encoded.ok) throw new Error(encoded.error.message);
  const source = join(directory, 'groups.koma');
  await writeFile(source, encoded.value);
  await answerOpenDialog(application, source);
  await window.getByRole('button', { name: 'Open a project', exact: true }).click();
  await expect(window.getByLabel('Project name')).toHaveValue(project.name);
  await showInspector(window);
  const inspector = window.getByRole('complementary', { name: 'Inspector' });
  const layers = inspector.getByRole('list', { name: 'Layers of this Koma' });

  // Where the objects are drawn before grouping, in window pixels.
  const before = await drawnBoxes([
    stage().locator('[data-element-id="badge-1"]'),
    stage().locator('[data-element-id="caption-1"]'),
  ]);

  // Select on the canvas, extend with Shift on the canvas and Ctrl/Cmd in Layers.
  const badgeOnCanvas = stage().getByRole('button', { name: 'Badge (shape)', exact: true });
  const captionOnCanvas = stage().getByRole('button', { name: 'Caption (text)', exact: true });
  await badgeOnCanvas.click();
  await captionOnCanvas.click({ modifiers: ['Shift'] });
  await expect(badgeOnCanvas).toHaveAttribute('aria-pressed', 'true');
  await expect(captionOnCanvas).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector.getByRole('heading', { name: '2 elements selected' })).toBeVisible();
  await layers.getByRole('button', { name: /^Marker,/ }).click({ modifiers: ['ControlOrMeta'] });
  await expect(inspector.getByRole('heading', { name: '3 elements selected' })).toBeVisible();
  await layers.getByRole('button', { name: /^Marker,/ }).click({ modifiers: ['ControlOrMeta'] });
  await expect(inspector.getByRole('heading', { name: '2 elements selected' })).toBeVisible();
  await expect(window.getByRole('button', { name: 'Group selected elements' })).toBeEnabled();
  await window.screenshot({ path: test.info().outputPath('selection.png'), scale: 'css' });

  await window.keyboard.press('ControlOrMeta+g');
  await expect(stage().locator('[data-element-id]')).toHaveCount(2);
  const groupOnCanvas = stage().getByRole('button', { name: 'Group (group)', exact: true });
  await expect(groupOnCanvas).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector.getByRole('heading', { name: 'Selected element: Group' })).toBeVisible();
  await expect(inspector.getByText('This group contains 2 elements.')).toBeVisible();
  await expect(
    inspector.getByRole('list', { name: 'Elements in this group' }).getByRole('listitem'),
  ).toHaveText(['Badge', 'Caption']);
  await expect(layers.getByRole('button', { name: /^Group, Group of 2/ })).toBeVisible();
  // Motion to the next Koma is recomputed and still plays.
  await expect(window.getByRole('region', { name: /^Transition 1 to 2\./ })).toHaveCount(0);
  await expect(
    window.getByRole('group', { name: 'Transition preview' }).getByRole('button', { name: 'Play' }),
  ).toBeEnabled();
  // The children are drawn where the separate objects were.
  const drawnChildren = groupOnCanvas.locator(':scope > div > div > div');
  await expect(drawnChildren).toHaveCount(2);
  expectSameBoxes(await drawnBoxes([drawnChildren.nth(0), drawnChildren.nth(1)]), before);
  await window.screenshot({ path: test.info().outputPath('grouped.png'), scale: 'css' });

  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(stage().locator('[data-element-id]')).toHaveCount(3);
  await window.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(stage().locator('[data-element-id]')).toHaveCount(2);

  await answerSaveDialog(application, source);
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('All changes saved')).toBeVisible();
  const saved = komaProjectSchema.parse(JSON.parse(await readFile(source, 'utf8')));
  const group = saved.presentation.komas[0]?.elements.find((element) => element.type === 'group');
  if (group?.type !== 'group') throw new Error('The saved Koma has no group');
  expect(
    group.content.children.map((child) => [child.id, child.persistentId, child.position]),
  ).toEqual([
    ['badge-1', 'badge', { x: 0, y: 0 }],
    ['caption-1', 'caption', { x: 0, y: 300 }],
  ]);
  expect(group).toMatchObject({
    position: { x: 100, y: 100 },
    size: { width: 800, height: 420 },
    content: { referenceSize: { width: 800, height: 420 } },
  });
  // The other Koma is unchanged. The objects fade into the group, which the
  // next Koma does not have; the transition keeps its id and settings.
  expect(saved.presentation.komas[1]).toEqual(second);
  const [stored] = saved.presentation.transitions;
  expect(stored).toMatchObject({
    id: project.presentation.transitions[0]?.id,
    duration: project.presentation.transitions[0]?.duration,
  });
  expect(
    stored?.elementTransitions.map((item) => `${item.persistentId}:${item.operation}`).sort(),
  ).toEqual(
    ['badge:fadeIn', 'caption:fadeIn', `${group.persistentId}:fadeOut`, 'marker:hold'].sort(),
  );

  await answerOpenDialog(application, source);
  await window.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(stage().locator('[data-element-id]')).toHaveCount(2);
  await expect(stage().locator(`[data-element-id="${group.id}"]`)).toBeVisible();
  await showInspector(window);

  // Select the reopened group from Layers and ungroup it in the Inspector.
  await layers.getByRole('button', { name: /^Group, Group of 2/ }).click();
  await expect(window.getByRole('button', { name: 'Ungroup selected group' })).toBeEnabled();
  await inspector.getByRole('button', { name: 'Ungroup', exact: true }).click();
  await expect(stage().locator('[data-element-id]')).toHaveCount(3);
  await expect(badgeOnCanvas).toHaveAttribute('aria-pressed', 'true');
  await expect(captionOnCanvas).toHaveAttribute('aria-pressed', 'true');
  expectSameBoxes(
    await drawnBoxes([
      stage().locator('[data-element-id="badge-1"]'),
      stage().locator('[data-element-id="caption-1"]'),
    ]),
    before,
  );

  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(stage().locator('[data-element-id]')).toHaveCount(2);
  // The keyboard shortcut ungroups the selected group too.
  await stage().locator(`[data-element-id="${group.id}"]`).click();
  await window.keyboard.press('ControlOrMeta+Shift+g');
  await expect(stage().locator('[data-element-id]')).toHaveCount(3);
  await window.keyboard.press('ControlOrMeta+z');
  await expect(stage().locator('[data-element-id]')).toHaveCount(2);
  await window.keyboard.press('ControlOrMeta+Shift+z');
  await expect(stage().locator('[data-element-id]')).toHaveCount(3);

  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('All changes saved')).toBeVisible();
  const ungrouped = komaProjectSchema.parse(JSON.parse(await readFile(source, 'utf8')));
  expect(ungrouped.presentation.komas[0]?.elements).toEqual(first.elements);
  expect(ungrouped.presentation.transitions).toEqual(project.presentation.transitions);
  await window.screenshot({ path: test.info().outputPath('ungrouped.png'), scale: 'css' });
  expect(running.problems).toEqual([]);
});
