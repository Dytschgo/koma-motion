import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { komaProjectSchema, type KomaProject } from '@koma-motion/core';
import { buildProject } from '@koma-motion/core/testing';
import { serialiseProject } from '@koma-motion/project-format';
import { expect, test } from '@playwright/test';
import { buildNavigationProject } from '../src/renderer/src/lib/deckNavigation.fixture';
import { buildDeck, makeStale } from '../src/renderer/src/lib/presentationDeck.fixture';
import { answerOpenDialog, launchApplication, type RunningApplication } from './application';

let running: RunningApplication;

test.beforeEach(async () => {
  running = await launchApplication();
});

test.afterEach(async () => {
  if (test.info().status !== test.info().expectedStatus) {
    await running.window.screenshot({
      path: test.info().outputPath('pane-failure.png'),
      scale: 'css',
    });
  }
  await running.close();
});

async function openDeck(project: KomaProject = buildNavigationProject()) {
  const encoded = serialiseProject(project);
  if (!encoded.ok) throw new Error(encoded.error.message);
  const path = join(running.directory, 'pane.koma');
  await writeFile(path, encoded.value);
  await answerOpenDialog(running.application, path);
  await running.window.getByRole('button', { name: 'Open a project', exact: true }).click();
  return { project, path };
}

function thumbnails() {
  return running.window.getByRole('list', { name: 'Komas', exact: true });
}

function thumbnail(number: number, title: string) {
  return thumbnails().getByRole('button', {
    name: `Koma ${String(number)}: ${title}`,
    exact: true,
  });
}

test('navigates thumbnails and reorders with PowerPoint-style keyboard controls', async () => {
  await openDeck();
  const { window, problems } = running;
  await thumbnail(1, 'Chapter 1').focus();
  await window.keyboard.press('ArrowDown');
  await expect(thumbnail(2, 'Chapter 2')).toBeFocused();
  await expect(thumbnail(2, 'Chapter 2')).toHaveAttribute('aria-current', 'true');
  await expect(window.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await window.keyboard.press('End');
  await expect(thumbnail(100, 'Chapter 100')).toBeFocused();
  await expect(thumbnail(100, 'Chapter 100')).toBeInViewport();
  await window.keyboard.press('Home');
  await window.keyboard.press('ArrowDown');
  await window.keyboard.press('ControlOrMeta+ArrowDown');
  await expect(thumbnail(3, 'Chapter 2')).toBeFocused();
  await window.keyboard.press('ControlOrMeta+Shift+ArrowDown');
  await expect(thumbnail(100, 'Chapter 2')).toBeFocused();
  await window.keyboard.press('ControlOrMeta+z');
  await expect(thumbnail(3, 'Chapter 2')).toHaveAttribute('aria-current', 'true');
  await window.keyboard.press('ControlOrMeta+z');
  await expect(thumbnail(2, 'Chapter 2')).toHaveAttribute('aria-current', 'true');
  await window.getByLabel('Project name').fill('A project name with normal editing');
  await window.getByLabel('Project name').press('ControlOrMeta+d');
  await expect(thumbnails().getByRole('button', { name: /^Koma \d+:/ })).toHaveCount(100);
  expect(problems).toEqual([]);
});

test('duplicates and deletes through a keyboard-accessible thumbnail context menu', async () => {
  const { project, path } = await openDeck();
  const { window, problems } = running;
  await thumbnail(2, 'Chapter 2').click({ button: 'right' });
  const menu = window.getByRole('menu', { name: 'Koma actions' });
  await expect(menu).toBeVisible();
  await expect(thumbnail(2, 'Chapter 2')).toHaveAttribute('aria-current', 'true');
  await menu.getByRole('menuitem', { name: /Duplicate Koma/ }).click();
  await expect(thumbnail(3, 'Chapter 2')).toHaveAttribute('aria-current', 'true');
  await expect(thumbnail(3, 'Chapter 2')).toBeFocused();
  await expect(thumbnails().getByRole('button', { name: /^Koma \d+:/ })).toHaveCount(101);
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('All changes saved')).toBeVisible();
  const saved = komaProjectSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  const original = project.presentation.komas[1];
  const copy = saved.presentation.komas[2];
  expect(copy?.id).not.toBe(original?.id);
  expect(copy?.title).toBe(original?.title);
  expect(copy?.holdDurationMs).toBe(original?.holdDurationMs);
  expect(copy?.elements.map((element) => element.persistentId)).toEqual(
    original?.elements.map((element) => element.persistentId),
  );
  await thumbnail(3, 'Chapter 2').focus();
  await window.keyboard.press('Shift+F10');
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await window.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(thumbnail(3, 'Chapter 2')).toBeFocused();
  await window.keyboard.press('Delete');
  const confirmation = window.getByRole('dialog', { name: 'Delete Koma 3?' });
  await confirmation.getByRole('button', { name: 'Delete Koma', exact: true }).click();
  await expect(thumbnail(3, 'Chapter 3')).toBeFocused();
  await expect(thumbnails().getByRole('button', { name: /^Koma \d+:/ })).toHaveCount(100);
  await window.keyboard.press('ControlOrMeta+z');
  await expect(thumbnails().getByRole('button', { name: /^Koma \d+:/ })).toHaveCount(101);
  expect(problems).toEqual([]);
});

test('resizes and collapses thumbnails without changing the document or losing focus', async () => {
  await openDeck();
  const { window, problems } = running;
  const pane = window.getByRole('complementary', { name: 'Project', exact: true });
  const resize = window.getByRole('separator', { name: 'Resize Koma thumbnails' });
  await resize.focus();
  await window.keyboard.press('ArrowRight');
  await expect(resize).toHaveAttribute('aria-valuenow', '260');
  await window.keyboard.press('Home');
  await expect(resize).toHaveAttribute('aria-valuenow', '180');
  await window.keyboard.press('End');
  await expect(resize).toHaveAttribute(
    'aria-valuenow',
    (await resize.getAttribute('aria-valuemax')) ?? '',
  );
  await window.getByRole('button', { name: 'Hide Koma thumbnails' }).click();
  const show = window.getByRole('button', { name: 'Show Koma thumbnails' });
  await expect(show).toBeFocused();
  await expect(thumbnails()).toBeHidden();
  await window.keyboard.press('Enter');
  await expect(thumbnail(1, 'Chapter 1')).toBeFocused();
  await expect(window.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await window.getByRole('button', { name: 'Show Koma details' }).click();
  await expect(pane.getByRole('button', { name: 'Hide Koma details' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    pane.getByRole('button', { name: 'Preview the transition from Koma 1 to Koma 2', exact: true }),
  ).toBeVisible();
  await window.screenshot({ path: test.info().outputPath('pane-details.png'), scale: 'css' });
  expect(problems).toEqual([]);
});

test('inserts after the selected thumbnail with duplicate and new-Koma shortcuts', async () => {
  await openDeck();
  const { window, problems } = running;
  await thumbnail(2, 'Chapter 2').focus();
  await window.keyboard.press('ControlOrMeta+d');
  await expect(thumbnail(3, 'Chapter 2')).toBeFocused();
  await window.keyboard.press('Control+m');
  await expect(thumbnail(4, 'Koma 102')).toBeFocused();
  await expect(thumbnail(5, 'Chapter 3')).toBeVisible();
  await window.keyboard.press('ControlOrMeta+z');
  await expect(thumbnails().getByRole('button', { name: /^Koma \d+:/ })).toHaveCount(101);
  await expect(thumbnails().locator('button[aria-current="true"]')).toBeFocused();
  await window.getByRole('button', { name: 'Hide Koma thumbnails' }).click();
  await window.getByRole('button', { name: 'Show Koma thumbnails' }).click();
  await expect(thumbnail(1, 'Chapter 1')).toBeFocused();
  await window.keyboard.press('ArrowDown');
  await expect(thumbnail(2, 'Chapter 2')).toBeFocused();
  await window.keyboard.press('ControlOrMeta+z');
  await expect(thumbnails().getByRole('button', { name: /^Koma \d+:/ })).toHaveCount(100);
  await expect(thumbnail(2, 'Chapter 2')).toBeFocused();
  await window.getByRole('button', { name: 'Hide Koma thumbnails' }).click();
  await window.getByRole('button', { name: 'Show Koma thumbnails' }).click();
  await expect(thumbnail(2, 'Chapter 2')).toBeFocused();
  await expect(window.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(problems).toEqual([]);
});

test('returns focus after cancelling deletion, leaving the menu, and deleting the final Koma', async () => {
  await openDeck(buildProject({ presentation: buildDeck(1) }));
  const { window, problems } = running;
  await thumbnail(1, 'One').focus();
  await window.keyboard.press('Delete');
  await window.getByRole('button', { name: 'Keep Koma' }).click();
  await expect(thumbnail(1, 'One')).toBeFocused();
  await window.keyboard.press('Shift+F10');
  await window.keyboard.press('Tab');
  await expect(window.getByRole('menu', { name: 'Koma actions' })).toBeHidden();
  // Tab continues from the thumbnail into the next enabled footer action.
  await expect(window.getByRole('button', { name: 'Delete Koma', exact: true })).toBeFocused();
  await thumbnail(1, 'One').focus();
  await window.keyboard.press('Delete');
  await window
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete Koma', exact: true })
    .click();
  await expect(window.getByRole('button', { name: 'Add Koma', exact: true })).toBeFocused();
  await expect(window.getByText('Your Komas will appear here.')).toBeVisible();
  await window.keyboard.press('ControlOrMeta+z');
  await expect(thumbnail(1, 'One')).toBeVisible();
  expect(problems).toEqual([]);
});

test('remembers pane preferences across reload and supports pointer resizing and edge collapse', async () => {
  await openDeck();
  const { window, problems } = running;
  const resize = window.getByRole('separator', { name: 'Resize Koma thumbnails' });
  const bounds = await resize.boundingBox();
  if (bounds === null) throw new Error('Expected the pane divider');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await window.mouse.move(x, y);
  await window.mouse.down();
  await window.mouse.move(x + 56, y, { steps: 8 });
  await window.mouse.up();
  await expect(resize).toHaveAttribute('aria-valuenow', '300');
  await window.getByRole('button', { name: 'Show Koma details' }).click();
  await window.getByRole('button', { name: 'Hide Koma thumbnails' }).click();
  await window.reload();
  await window.getByRole('button', { name: 'Open a project', exact: true }).click();
  await expect(window.getByRole('button', { name: 'Show Koma thumbnails' })).toBeVisible();
  await window.getByRole('button', { name: 'Show Koma thumbnails' }).click();
  await expect(resize).toHaveAttribute('aria-valuenow', '300');
  await expect(window.getByRole('button', { name: 'Hide Koma details' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const restored = await resize.boundingBox();
  if (restored === null) throw new Error('Expected the restored divider');
  await window.mouse.move(restored.x + restored.width / 2, y);
  await window.mouse.down();
  await window.mouse.move(60, y, { steps: 12 });
  await window.mouse.up();
  await expect(window.getByRole('button', { name: 'Show Koma thumbnails' })).toBeFocused();
  await expect(window.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(problems).toEqual([]);
});

test('keeps motion recovery reachable in compact 4:3 thumbnails at short window height', async () => {
  const presentation = makeStale(buildDeck(3), 1);
  await openDeck(buildProject({ presentation: { ...presentation, aspectRatio: '4:3' } }));
  const { window, application, problems } = running;
  await window.emulateMedia({ reducedMotion: 'reduce' });
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 640),
  );
  await expect(window.getByRole('button', { name: 'Show Koma details' })).toBeVisible();
  await expect(
    window.getByRole('button', { name: /Regenerate transition from/ }).first(),
  ).toBeVisible();
  await expect(window.getByRole('button', { name: 'Add Koma', exact: true })).toBeInViewport();
  await expect(window.getByRole('button', { name: 'Brand Kit', exact: true })).toBeInViewport();
  await thumbnail(1, 'One').focus();
  await window.keyboard.press('End');
  await expect(thumbnail(3, 'Three')).toBeFocused();
  await expect(thumbnail(3, 'Three')).toBeInViewport();
  await window.screenshot({ path: test.info().outputPath('pane-short-4-3.png'), scale: 'css' });
  expect(problems).toEqual([]);
});

test('captures the thumbnail pane with a generated presentation at wide and narrow sizes', async () => {
  const { window, application, problems } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await window.getByRole('button', { name: 'Use the example request' }).click();
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
  for (const width of [1480, 1120] as const) {
    await application.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setContentSize(size, 920),
      width,
    );
    await expect.poll(() => window.evaluate(() => innerWidth)).toBe(width);
    await window.screenshot({
      path: test.info().outputPath(`pane-${String(width)}.png`),
      scale: 'css',
    });
  }
  expect(problems).toEqual([]);
});
