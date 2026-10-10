import { komaProjectSchema } from '@koma-motion/core';
import { serialiseProject } from '@koma-motion/project-format';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import { buildNavigationProject } from '../src/renderer/src/lib/deckNavigation.fixture';
import { answerOpenDialog, launchApplication, type RunningApplication } from './application';

let running: RunningApplication;
test.beforeEach(async () => {
  running = await launchApplication();
});
test.afterEach(async () => {
  await running.close();
});

function strip() {
  return running.window.getByRole('list', { name: 'Komas', exact: true });
}

function komaButton(number: number, title: string) {
  return strip().getByRole('button', { name: `Koma ${String(number)}: ${title}`, exact: true });
}

/** The titles of the first `count` Komas, in strip order. */
async function stripTitles(count: number): Promise<string[]> {
  const names = await strip()
    .getByRole('button', { name: /^Koma \d+: / })
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? ''));
  return names.slice(0, count).map((name) => name.replace(/^Koma \d+: /, ''));
}

async function box(locator: Locator) {
  const result = await locator.boundingBox();
  if (result === null) throw new Error('The element is not visible.');
  return result;
}

test('reorders Komas by dragging in a small window, with undo, Escape, auto-scroll and drops in place', async () => {
  const { window, application } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1120, 668);
  });
  await window.emulateMedia({ reducedMotion: 'reduce' });
  const project = buildNavigationProject();
  const encoded = serialiseProject(project);
  if (!encoded.ok) throw new Error(encoded.error.message);
  const source = join(running.directory, 'drag.koma');
  await writeFile(source, encoded.value);
  await answerOpenDialog(application, source);
  await window.getByRole('button', { name: 'Open a project', exact: true }).click();
  await expect(window.getByLabel('Project name')).toHaveValue(project.name);
  const { mouse } = window;
  const undo = window.getByRole('button', { name: 'Undo', exact: true });
  const redo = window.getByRole('button', { name: 'Redo', exact: true });
  const announcement = window.locator('[aria-live="polite"]').filter({ hasText: /Koma \d+/ });
  const indicator = strip().locator('[data-koma-drop-indicator]');
  const scroller = strip().locator('..');
  const scrollToTop = () =>
    scroller.evaluate((element) => {
      element.scrollTop = 0;
    });
  const original = ['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4'];
  const koma2First = ['Chapter 2', 'Chapter 1', 'Chapter 3', 'Chapter 4'];
  expect(await stripTitles(4)).toEqual(original);
  await expect(undo).toBeDisabled();
  const viewport = await window.evaluate(() => `${String(innerWidth)} x ${String(innerHeight)}`);
  const stripBox = await box(scroller);
  test.info().annotations.push({
    type: 'layout',
    description: `viewport ${viewport}, strip height ${String(stripBox.height)}`,
  });

  // In the small window only Koma 1 and the top of Koma 2 fit. Drag Koma 2
  // above the middle of Koma 1: the indicator marks the gap before Koma 1.
  await expect(komaButton(2, 'Chapter 2')).toBeInViewport();
  const koma1 = await box(komaButton(1, 'Chapter 1'));
  const koma2 = await box(komaButton(2, 'Chapter 2'));
  const dragX = koma2.x + koma2.width / 2;
  const grabKoma2 = Math.min(koma2.y + 12, stripBox.y + stripBox.height - 4);
  const aboveKoma1 = koma1.y + koma1.height * 0.35;
  const dragKoma2Up = async (): Promise<void> => {
    await scrollToTop();
    await mouse.move(dragX, grabKoma2);
    await mouse.down();
    await mouse.move(dragX, grabKoma2 - 10, { steps: 2 });
    await mouse.move(dragX, aboveKoma1, { steps: 8 });
  };
  await dragKoma2Up();
  await expect(indicator).toHaveCount(1);
  await expect(indicator).toHaveAttribute('data-koma-drop-indicator', 'before');
  await expect(indicator).toBeVisible();
  await window.screenshot({ path: test.info().outputPath('drag-indicator.png') });
  await mouse.up();
  await expect(indicator).toHaveCount(0);
  expect(await stripTitles(4)).toEqual(koma2First);
  await expect(komaButton(1, 'Chapter 2')).toHaveAttribute('aria-current', 'true');
  await expect(announcement).toHaveText('Koma 2 moved to position 1.');
  await expect(window.getByText('Unsaved changes')).toBeVisible();

  await undo.click();
  expect(await stripTitles(4)).toEqual(original);
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
  await expect(window.getByText('All changes saved')).toBeVisible();

  // Escape cancels a drag: nothing moves, and the redo step survives.
  await dragKoma2Up();
  await expect(indicator).toHaveCount(1);
  await window.keyboard.press('Escape');
  await expect(indicator).toHaveCount(0);
  await mouse.up();
  expect(await stripTitles(4)).toEqual(original);
  await expect(announcement).toHaveText('Move cancelled. Koma 2 stays at position 2.');
  await expect(redo).toBeEnabled();
  await expect(undo).toBeDisabled();

  // Dropping a Koma beside itself is not a document change.
  await scrollToTop();
  const koma1Centre = koma1.y + koma1.height / 2;
  await mouse.move(dragX, koma1Centre);
  await mouse.down();
  await mouse.move(dragX, koma1Centre - 12, { steps: 4 });
  await expect(indicator).toHaveCount(0);
  await mouse.up();
  expect(await stripTitles(4)).toEqual(original);
  await expect(announcement).toHaveText('Koma 1 stays at position 1.');
  await expect(redo).toBeEnabled();
  await expect(undo).toBeDisabled();

  // A plain click still selects without moving anything.
  await komaButton(2, 'Chapter 2').click();
  await expect(komaButton(2, 'Chapter 2')).toHaveAttribute('aria-current', 'true');
  expect(await stripTitles(4)).toEqual(original);
  await expect(redo).toBeEnabled();

  // Holding a dragged Koma at the strip's bottom edge scrolls the strip; Escape still cancels.
  await scrollToTop();
  const grabKoma1 = koma1.y + 20;
  await mouse.move(dragX, grabKoma1);
  await mouse.down();
  await mouse.move(dragX, grabKoma1 + 10, { steps: 2 });
  await mouse.move(dragX, stripBox.y + stripBox.height - 6, { steps: 8 });
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(200);
  await expect(indicator).toHaveCount(1);
  await window.keyboard.press('Escape');
  await mouse.up();
  expect(await stripTitles(4)).toEqual(original);
  await expect(redo).toBeEnabled();

  // Drag again, then the move buttons keep working alongside dragging.
  await dragKoma2Up();
  await mouse.up();
  expect(await stripTitles(4)).toEqual(koma2First);
  await expect(redo).toBeDisabled();
  const moveDown = window.getByRole('button', { name: 'Move Koma down', exact: true });
  await moveDown.click();
  expect(await stripTitles(4)).toEqual(original);
  await moveDown.click();
  expect(await stripTitles(4)).toEqual(['Chapter 1', 'Chapter 3', 'Chapter 2', 'Chapter 4']);
  await undo.click();
  await undo.click();
  expect(await stripTitles(4)).toEqual(koma2First);
  await undo.click();
  expect(await stripTitles(4)).toEqual(original);
  await redo.click();
  expect(await stripTitles(4)).toEqual(koma2First);

  // The dragged order is what is saved, with motion reconnected for the new neighbours.
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('All changes saved')).toBeVisible();
  const saved = komaProjectSchema.parse(JSON.parse(await readFile(source, 'utf8')));
  expect(saved.presentation.komas.slice(0, 4).map((koma) => koma.id)).toEqual([
    'koma-2',
    'koma-1',
    'koma-3',
    'koma-4',
  ]);
  expect(saved.presentation.transitions).toHaveLength(99);
  for (const [index, transition] of saved.presentation.transitions.entries()) {
    expect(transition.fromKomaId).toBe(saved.presentation.komas[index]?.id);
    expect(transition.toKomaId).toBe(saved.presentation.komas[index + 1]?.id);
  }
  expect(saved.presentation.transitions.slice(2)).toEqual(
    project.presentation.transitions.slice(2),
  );
  expect(running.problems).toEqual([]);
});
