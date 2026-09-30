import {
  buildKoma,
  buildPresentation,
  buildProject,
  buildShape,
  buildText,
} from '@koma-motion/core/testing';
import {
  komaProjectSchema,
  createSeededIdGenerator,
  MAX_ELEMENT_TEXT_LENGTH,
} from '@koma-motion/core';
import { syncTransitions } from '@koma-motion/motion-engine';
import { serialiseProject } from '@koma-motion/project-format';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
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

async function openFixture(): Promise<void> {
  const from = buildKoma({
    elements: [
      buildShape(),
      buildText(),
      buildShape({
        id: 'locked',
        persistentId: 'locked',
        name: 'Locked',
        locked: true,
        position: { x: 1400, y: 100 },
      }),
    ],
  });
  const to = buildKoma({
    id: 'koma-2',
    elements: from.elements.map((element) => ({ ...element, id: `${element.id}-2` })),
  });
  const project = buildProject({
    presentation: syncTransitions(
      buildPresentation({ komas: [from, to], transitions: [] }),
      createSeededIdGenerator('canvas'),
    ).presentation,
  });
  const result = serialiseProject(project);
  if (!result.ok) throw new Error(result.error.message);
  const path = join(running.directory, 'canvas.koma');
  await writeFile(path, result.value);
  await answerOpenDialog(running.application, path);
  await running.window.getByRole('button', { name: 'Open a project', exact: true }).click();
  await expect(
    running.window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]'),
  ).toBeVisible();
  await showInspector(running.window);
}

test('moves, resizes, cancels and edits text with one undo per committed gesture', async () => {
  await openFixture();
  const { window } = running;
  const stage = window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');
  const shape = stage.getByRole('button', { name: 'Shape (shape)', exact: true });
  await shape.click();
  await shape.hover();
  const rect = await stage.boundingBox();
  if (!rect) throw new Error('No canvas');
  const scale = rect.width / 1920;
  const box = await shape.boundingBox();
  if (!box) throw new Error('No shape');
  await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await window.mouse.down();
  await window.mouse.move(box.x + box.width / 2 + 80 * scale, box.y + box.height / 2 + 40 * scale, {
    steps: 5,
  });
  await window.mouse.up();
  await expect(window.getByLabel('X', { exact: true })).toHaveValue('180');
  await expect(window.getByLabel('Y', { exact: true })).toHaveValue('140');
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(window.getByLabel('X', { exact: true })).toHaveValue('100');
  await window.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(window.getByLabel('X', { exact: true })).toHaveValue('180');

  await stage.getByRole('button', { name: 'Resize Shape se' }).hover();
  const resizeRect = await stage.boundingBox();
  if (!resizeRect) throw new Error('No resize canvas');
  const resizeScale = resizeRect.width / 1920;
  await window.screenshot({ path: test.info().outputPath('before-resize.png') });
  const handle = await stage.getByRole('button', { name: 'Resize Shape se' }).boundingBox();
  if (!handle) throw new Error('No handle');
  await window.mouse.move(handle.x + 6, handle.y + 6);
  await window.mouse.down();
  await window.mouse.move(handle.x + 6 + 100 * resizeScale, handle.y + 6 + 60 * resizeScale, {
    steps: 4,
  });
  await window.mouse.up();
  await window.screenshot({ path: test.info().outputPath('after-resize.png') });
  await expect(window.getByLabel('Width', { exact: true })).toHaveValue('300');
  await expect(window.getByLabel('Height', { exact: true })).toHaveValue('260');
  expect((await stage.boundingBox())?.width).toBe(resizeRect.width);
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(window.getByLabel('Width', { exact: true })).toHaveValue('200');
  await window.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(window.getByLabel('Width', { exact: true })).toHaveValue('300');

  const moved = await shape.boundingBox();
  if (!moved) throw new Error('No shape');
  await window.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2);
  await window.mouse.down();
  await window.mouse.move(rect.x - 10, rect.y + 10);
  await window.mouse.up();
  await expect(window.getByLabel('X', { exact: true })).toHaveValue('180');
  await shape.focus();
  await window.keyboard.press('Shift+ArrowRight');
  await expect(window.getByLabel('X', { exact: true })).toHaveValue('190');

  const text = stage.getByRole('button', { name: 'Text (text)', exact: true });
  await text.hover();
  const textBox = await text.boundingBox();
  const textStage = await stage.boundingBox();
  if (!textBox || !textStage) throw new Error('No text canvas');
  await window.mouse.move(textBox.x + textBox.width / 2, textBox.y + textBox.height / 2);
  await window.mouse.down();
  await window.mouse.move(
    textBox.x + textBox.width / 2 + (20 * textStage.width) / 1920,
    textBox.y + textBox.height / 2,
  );
  await window.mouse.up();
  await expect(window.getByLabel('X', { exact: true })).toHaveValue('120');
  await text.dblclick();
  await window
    .getByRole('textbox', { name: 'Edit text: Text', exact: true })
    .fill('Cancelled copy');
  await window.keyboard.press('Escape');
  await expect(text).toHaveText('Presentations are frames.');
  await window.getByRole('button', { name: 'Edit text', exact: true }).click();
  await window
    .getByRole('textbox', { name: 'Edit text: Text', exact: true })
    .fill('Saved canvas copy');
  await window.keyboard.press('ControlOrMeta+Enter');
  await expect(text).toHaveText('Saved canvas copy');
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(text).toHaveText('Presentations are frames.');
  await window.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(text).toHaveText('Saved canvas copy');
  await expect(window.getByLabel('Text', { exact: true })).toHaveValue('Saved canvas copy');
  await window.getByLabel('Text', { exact: true }).fill('Inspector copy');
  await expect(text).toHaveText('Inspector copy');
  await expect(
    window.getByRole('list', { name: 'Komas' }).getByRole('button', { name: /Resize/ }),
  ).toHaveCount(0);
  // Its lower left corner, as the text editing controls float over the top right of the canvas.
  const locked = stage.getByRole('button', { name: 'Locked (shape)' });
  const lockedBox = await locked.boundingBox();
  if (!lockedBox) throw new Error('No locked shape');
  await locked.click({ position: { x: 4, y: lockedBox.height - 4 } });
  await expect(stage.getByRole('button', { name: /Resize/ })).toHaveCount(0);

  // The edits moved objects of the first Koma, so its transition must be
  // regenerated before it can be previewed. The edits stay.
  await expect(window.getByLabel('Position in the transition')).toBeDisabled();
  const warning = window.getByRole('region', { name: /Transition 1 to 2\./ });
  await warning.getByRole('button', { name: 'Regenerate transition' }).click();
  await expect(warning).toHaveCount(0);
  await window.getByLabel('Position in the transition').fill('500');
  await expect(stage.getByRole('button')).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'Add image', exact: true })).toBeDisabled();
  await expect(window.getByLabel('Title', { exact: true })).toBeDisabled();
  await window.getByRole('button', { name: 'Stop preview', exact: true }).click();
  await expect(shape).toBeVisible();
  await shape.click();
  await window.screenshot({ path: test.info().outputPath('canvas-selection.png') });
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  await answerOpenDialog(running.application, join(running.directory, 'canvas.koma'));
  await window.getByRole('button', { name: 'Open', exact: true }).click();
  await shape.click();
  await expect(window.getByLabel('X', { exact: true })).toHaveValue('190');
  await expect(window.getByLabel('Width', { exact: true })).toHaveValue('300');
  await expect(text).toHaveText('Inspector copy');
  expect(running.problems).toEqual([]);
});

test('validates, imports, saves, reopens and replaces embedded images', async () => {
  await openFixture();
  const { window, application, directory } = running;
  const stage = window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');
  const invalid = join(directory, 'bad.png');
  await writeFile(invalid, '<svg onload="alert(1)"/>');
  await answerOpenDialog(application, invalid);
  await window.getByRole('button', { name: 'Add image', exact: true }).click();
  await expect(
    window.getByText('The selected file is not a PNG, JPEG, WebP or GIF image.'),
  ).toBeVisible();
  const imagePath = join(directory, 'picture.png');
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  await writeFile(imagePath, Buffer.from(png, 'base64'));
  await answerOpenDialog(application, imagePath);
  await window.getByRole('button', { name: 'Add image', exact: true }).click();
  const image = stage.getByRole('button', { name: 'picture.png (image)', exact: true });
  await expect(image).toBeVisible();
  await expect(image.locator('img')).toHaveAttribute('src', `data:image/png;base64,${png}`);
  await image.hover();
  const imageBox = await image.boundingBox();
  const imageStage = await stage.boundingBox();
  if (!imageBox || !imageStage) throw new Error('No image canvas');
  await window.mouse.move(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2);
  await window.mouse.down();
  await window.mouse.move(
    imageBox.x + imageBox.width / 2 + (40 * imageStage.width) / 1920,
    imageBox.y + imageBox.height / 2,
  );
  await window.mouse.up();
  await expect(window.getByLabel('X', { exact: true })).toHaveValue('520');
  const savedPath = join(directory, 'saved.koma');
  await answerSaveDialog(application, savedPath);
  await window.getByRole('button', { name: 'Save as', exact: true }).click();
  await expect(window.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  const saved = komaProjectSchema.parse(JSON.parse(await readFile(savedPath, 'utf8')));
  expect(saved.assets[0]?.embeddedData?.data).toBe(png);
  const original = saved.presentation.komas[0]?.elements.find((item) => item.type === 'image');
  await answerOpenDialog(application, savedPath);
  await window.getByRole('button', { name: 'Open', exact: true }).click();
  await image.click();
  await expect(window.getByLabel('X', { exact: true })).toHaveValue('520');
  await answerOpenDialog(application, imagePath);
  await window.getByRole('button', { name: 'Replace image', exact: true }).click();
  await expect(window.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(window.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  await window.getByRole('button', { name: 'Redo', exact: true }).click();
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  const replaced = komaProjectSchema.parse(JSON.parse(await readFile(savedPath, 'utf8')));
  const next = replaced.presentation.komas[0]?.elements.find((item) => item.id === original?.id);
  expect(next).toMatchObject({
    id: original?.id,
    persistentId: original?.persistentId,
    position: original?.position,
  });
  expect(replaced.assets).toHaveLength(1);
  expect(replaced.assets[0]?.id).not.toBe(saved.assets[0]?.id);
  expect(running.problems).toEqual([]);
});

test('cancels pointer and text drafts and maps dragging at a different zoom', async () => {
  await openFixture();
  const { window } = running;
  const stage = window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');
  const shape = stage.getByRole('button', { name: 'Shape (shape)', exact: true });
  const beginDrag = async (): Promise<void> => {
    await shape.hover();
    const box = await shape.boundingBox();
    if (!box) throw new Error('No shape');
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await window.mouse.down();
    await window.mouse.move(box.x + box.width / 2 + 15, box.y + box.height / 2 + 10);
  };
  await beginDrag();
  await window.keyboard.press('Escape');
  await window.mouse.up();
  await expect(window.getByLabel('X', { exact: true })).toHaveValue('100');
  await expect(window.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await beginDrag();
  await shape.dispatchEvent('pointercancel');
  await window.mouse.up();
  await expect(window.getByLabel('X', { exact: true })).toHaveValue('100');
  await expect(window.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();

  const text = stage.getByRole('button', { name: 'Text (text)', exact: true });
  await text.click();
  await text.press('Enter');
  await window.getByRole('textbox', { name: 'Edit text: Text', exact: true }).fill('Discard this');
  await window.keyboard.press('Escape');
  await expect(text).toHaveText('Presentations are frames.');
  await expect(text).toBeFocused();
  await expect(window.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();

  await window.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await shape.hover();
  const rect = await stage.boundingBox();
  const box = await shape.boundingBox();
  if (!rect || !box) throw new Error('No zoomed canvas');
  await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await window.mouse.down();
  await window.mouse.move(box.x + box.width / 2 + (70 * rect.width) / 1920, box.y + box.height / 2);
  await window.mouse.up();
  await expect(window.getByLabel('X', { exact: true })).toHaveValue('170');
  expect(running.problems).toEqual([]);
});

test('edits multiline text with the keyboard, saves, reopens and preserves undo boundaries', async () => {
  await openFixture();
  const { window } = running;
  const stage = window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');
  const text = stage.getByRole('button', { name: 'Text (text)', exact: true });
  const editor = stage.getByRole('textbox', { name: 'Edit text: Text', exact: true });
  await text.focus();
  await text.press('Space');
  await text.press('Enter');
  await expect(editor).toBeFocused();
  expect(
    await editor.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd]),
  ).toEqual([25, 25]);
  await editor.press('Enter');
  await editor.pressSequentially('Second line');
  const draft = 'Presentations are frames.\nSecond line';
  await expect(editor).toHaveValue(draft);
  await editor.press('Home');
  await editor.press('Shift+End');
  expect(
    await editor.evaluate((node: HTMLTextAreaElement) =>
      node.value.slice(node.selectionStart, node.selectionEnd),
    ),
  ).toBe('Second line');
  await expect(stage.getByRole('button', { name: /Resize/ })).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'Apply text' })).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'Cancel text edit' })).toHaveCount(0);
  await window.screenshot({ path: test.info().outputPath('direct-text-editing.png') });
  await editor.press('ControlOrMeta+Enter');
  await expect(editor).toHaveCount(0);
  await expect(text).toBeFocused();
  await expect(window.getByLabel('Text', { exact: true })).toHaveValue(draft);
  await expect(window.getByLabel('X', { exact: true })).toHaveValue('100');
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(text).toHaveText('Presentations are frames.');
  await expect(window.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await window.getByRole('button', { name: 'Redo', exact: true }).click();
  await text.press('Enter');
  await editor.fill('Discard this session');
  await editor.press('Escape');
  await expect(window.getByLabel('Text', { exact: true })).toHaveValue(draft);
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  const saved = komaProjectSchema.parse(
    JSON.parse(await readFile(join(running.directory, 'canvas.koma'), 'utf8')),
  );
  expect(
    saved.presentation.komas[0]?.elements.find((item) => item.type === 'text')?.content,
  ).toEqual({ text: draft });
  await answerOpenDialog(running.application, join(running.directory, 'canvas.koma'));
  await window.getByRole('button', { name: 'Open', exact: true }).click();
  await text.click();
  await expect(window.getByLabel('Text', { exact: true })).toHaveValue(draft);
  expect(running.problems).toEqual([]);
});

test('commits on Tab, another selection, stage background and preview focus exit', async () => {
  await openFixture();
  const { window } = running;
  const stage = window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');
  const text = stage.getByRole('button', { name: 'Text (text)', exact: true });
  const editor = stage.getByRole('textbox', { name: 'Edit text: Text', exact: true });
  await text.click();
  await text.press('Enter');
  await editor.fill('Tabbed copy');
  await editor.press('Tab');
  await expect(editor).toHaveCount(0);
  await expect(text).toHaveText('Tabbed copy');
  await text.press('Enter');
  await editor.fill('Selected copy');
  await stage.getByRole('button', { name: 'Shape (shape)', exact: true }).click();
  await expect(text).toHaveText('Selected copy');
  await expect(stage.getByRole('button', { name: 'Shape (shape)', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await text.click();
  await text.press('Enter');
  await editor.fill('Background copy');
  await stage.click({ position: { x: 5, y: 5 } });
  await expect(editor).toHaveCount(0);
  await expect(text).toHaveText('Background copy');
  await text.click();
  await text.press('Enter');
  await editor.fill('Preview copy');
  await window.getByLabel('Position in the transition').focus();
  await window.getByLabel('Position in the transition').fill('500');
  await expect(editor).toHaveCount(0);
  await expect(stage.getByRole('button')).toHaveCount(0);
  await window.getByRole('button', { name: 'Stop preview', exact: true }).click();
  await expect(text).toHaveText('Preview copy');
  await text.click();
  await text.press('Enter');
  await editor.fill('Next Koma copy');
  await window.getByRole('button', { name: 'Next Koma', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await window.getByRole('button', { name: 'Previous Koma', exact: true }).click();
  await expect(text).toHaveText('Next Koma copy');
  expect(running.problems).toEqual([]);
});

test('retains invalid drafts on focus exit, blocks preview/selection and recovers or cancels', async () => {
  await openFixture();
  const { window } = running;
  const stage = window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');
  const text = stage.getByRole('button', { name: 'Text (text)', exact: true });
  const editor = stage.getByRole('textbox', { name: 'Edit text: Text', exact: true });
  const error = stage.getByRole('alert');
  await text.click();
  await text.press('Enter');
  const invalid = 'x'.repeat(MAX_ELEMENT_TEXT_LENGTH + 1);
  await editor.fill(invalid);
  await editor.press('Tab');
  await expect(error).toBeFocused();
  await expect(editor).toHaveValue(invalid);
  await expect(error).toContainText('100,000-character');
  await window.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(error).toBeFocused();
  await expect(window.getByRole('button', { name: 'Stop preview', exact: true })).toHaveCount(0);
  await stage.getByRole('button', { name: 'Shape (shape)', exact: true }).click();
  await expect(text).toHaveAttribute('aria-pressed', 'true');
  await expect(editor).toHaveValue(invalid);
  await window.screenshot({ path: test.info().outputPath('invalid-text-retained.png') });
  await error.press('Tab');
  await expect(stage.getByRole('button', { name: 'Return to text' })).toBeFocused();
  await window.keyboard.press('Enter');
  await expect(editor).toBeFocused();
  await editor.fill('Recovered copy');
  await editor.press('ControlOrMeta+Enter');
  await expect(text).toHaveText('Recovered copy');
  await text.press('Enter');
  await editor.fill(invalid);
  await editor.press('ControlOrMeta+Enter');
  await expect(error).toBeFocused();
  await error.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(text).toHaveText('Recovered copy');
  expect(running.problems).toEqual([]);
});

test('keeps editor bounds at zoom/resize and discards drafts when reopening the same project', async () => {
  await openFixture();
  const { window, application, directory } = running;
  const stage = window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');
  const text = stage.getByRole('button', { name: 'Text (text)', exact: true });
  const editor = stage.getByRole('textbox', { name: 'Edit text: Text', exact: true });
  await window.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await text.click();
  await text.press('Enter');
  await editor.fill('Resize draft');
  const before = await editor.boundingBox();
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setSize(1100, 760),
  );
  await expect.poll(async () => (await editor.boundingBox())?.width).not.toBe(before?.width);
  await expect(editor).toHaveValue('Resize draft');
  const canvasBox = await stage.boundingBox();
  const editBox = await editor.boundingBox();
  if (!canvasBox || !editBox) throw new Error('Missing editor bounds');
  expect(editBox.x).toBeGreaterThanOrEqual(canvasBox.x);
  expect(editBox.y).toBeGreaterThanOrEqual(canvasBox.y);
  expect(editBox.x + editBox.width).toBeLessThanOrEqual(canvasBox.x + canvasBox.width + 1);
  expect(editBox.y + editBox.height).toBeLessThanOrEqual(canvasBox.y + canvasBox.height + 1);
  await window.screenshot({ path: test.info().outputPath('resized-text-editing.png') });
  await answerOpenDialog(application, join(directory, 'canvas.koma'));
  // The app's keyboard shortcut replaces the project without a pointer focus exit.
  await editor.press('ControlOrMeta+o');
  await expect(editor).toHaveCount(0);
  await text.click();
  await text.press('Enter');
  await expect(editor).toHaveValue('Presentations are frames.');
  await editor.press('Escape');
  expect(running.problems).toEqual([]);
});
