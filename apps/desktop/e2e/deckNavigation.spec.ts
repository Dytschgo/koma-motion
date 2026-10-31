import { komaProjectSchema, type KomaProject } from '@koma-motion/core';
import { validateTransition } from '@koma-motion/motion-engine';
import { serialiseProject } from '@koma-motion/project-format';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { recordInputEvidence } from './inputEvidence';
import { openKomaActions } from './komaControls';
import { buildNavigationProject } from '../src/renderer/src/lib/deckNavigation.fixture';
import {
  answerOpenDialog,
  launchApplication,
  type RunningApplication,
  chooseProjectCommand,
} from './application';

let running: RunningApplication;
let inputEvidence: () => readonly unknown[];
test.beforeEach(async () => {
  running = await launchApplication();
  inputEvidence = await recordInputEvidence(running.window);
});
test.afterEach(async () => {
  await writeFile(
    test.info().outputPath('input-events.json'),
    JSON.stringify(inputEvidence(), null, 2),
  );
  await running.close();
});

async function openLongDeck(project: KomaProject = buildNavigationProject()) {
  const encoded = serialiseProject(project);
  if (!encoded.ok) throw new Error(encoded.error.message);
  const source = join(running.directory, 'navigation.koma');
  await writeFile(source, encoded.value);
  await answerOpenDialog(running.application, source);
  await running.window.getByRole('button', { name: 'Open a project', exact: true }).click();
  await expect(running.window.getByLabel('Project name')).toHaveValue(project.name);
  return { project, source, encoded: encoded.value };
}

function strip() {
  return running.window.getByRole('list', { name: 'Komas', exact: true });
}

async function expectSelected(number: number, title: string) {
  const selected = strip().getByRole('button', {
    name: `Koma ${String(number)}: ${title}`,
    exact: true,
  });
  await expect(selected).toHaveAttribute('aria-current', 'true');
  await expect(selected).toBeInViewport();
}

async function overview() {
  await running.window.getByRole('button', { name: /^Deck overview/ }).click();
  const dialog = running.window.getByRole('dialog', { name: 'Deck overview', exact: true });
  await expect(dialog.getByLabel('Find a Koma')).toBeFocused();
  return dialog;
}

async function saveAndRead(source: string) {
  await chooseProjectCommand(running.window, 'Save');
  await expect(running.window.getByText('All changes saved')).toBeVisible();
  return komaProjectSchema.parse(JSON.parse(await readFile(source, 'utf8')));
}

function expectPreserved(before: KomaProject, after: KomaProject) {
  expect(after.presentation.komas).toHaveLength(100);
  for (const koma of after.presentation.komas)
    expect(koma).toEqual(before.presentation.komas.find((old) => old.id === koma.id));
  expect(after.generationHistory).toEqual(before.generationHistory);
  expect(after.presentation.transitions).toHaveLength(99);
  let newEdges = 0;
  for (const [index, transition] of after.presentation.transitions.entries()) {
    expect(transition.fromKomaId).toBe(after.presentation.komas[index]?.id);
    expect(transition.toKomaId).toBe(after.presentation.komas[index + 1]?.id);
    const original = before.presentation.transitions.find(
      (old) => old.fromKomaId === transition.fromKomaId && old.toKomaId === transition.toKomaId,
    );
    if (original) expect(transition).toEqual(original);
    else {
      newEdges++;
      expect(before.presentation.transitions.some((old) => old.id === transition.id)).toBe(false);
      expect(validateTransition(transition, after.presentation)).toEqual([]);
    }
  }
  expect(newEdges).toBeGreaterThan(0);
}

test('searches a 100-Koma deck by metadata with narrow keyboard navigation, focus return and no document changes', async () => {
  const { window, application } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 800);
  });
  await window.emulateMedia({ reducedMotion: 'reduce' });
  const { source, encoded } = await openLongDeck();
  const trigger = window.getByRole('button', { name: /^Deck overview/ });
  let dialog = await overview();
  await dialog.getByLabel('Find a Koma').fill('quarterly REVENUE');
  const results = dialog.getByRole('list', { name: 'Deck overview', exact: true });
  await expect(results.getByRole('button')).toHaveCount(1);
  await expect(
    results.getByRole('button', { name: 'Koma 50: Chapter 50', exact: true }),
  ).toBeVisible();
  await dialog.getByLabel('Find a Koma').press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expectSelected(1, 'Chapter 1');

  dialog = await overview();
  await dialog.getByLabel('Find a Koma').fill('100');
  await dialog.getByLabel('Find a Koma').press('Enter');
  await expectSelected(100, 'Chapter 100');
  await expect(trigger).toBeFocused();

  dialog = await overview();
  await dialog.getByLabel('Find a Koma').fill('Chapter 9');
  await dialog.getByLabel('Find a Koma').press('ArrowDown');
  await expect(
    dialog.getByRole('button', { name: 'Koma 9: Chapter 9', exact: true }),
  ).toBeFocused();
  await window.keyboard.press('End');
  await expect(
    dialog.getByRole('button', { name: 'Koma 99: Chapter 99', exact: true }),
  ).toBeFocused();
  await window.keyboard.press('Home');
  await window.keyboard.press('ArrowDown');
  await expect(
    dialog.getByRole('button', { name: 'Koma 19: Chapter 19', exact: true }),
  ).toBeFocused();
  await window.keyboard.press('Enter');
  await expectSelected(19, 'Chapter 19');
  await expect(window.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(await readFile(source, 'utf8')).toBe(encoded);

  dialog = await overview();
  await dialog.getByLabel('Find a Koma').fill('no matching metadata');
  await expect(dialog.getByText('No Komas match this search.')).toBeVisible();
  await dialog.getByLabel('Find a Koma').press('Escape');
  await expectSelected(19, 'Chapter 19');
  await window
    .getByRole('button', { name: 'Edit motion from Koma 19 to Koma 20', exact: true })
    .click();
  await expectSelected(19, 'Chapter 19');
  await window
    .getByRole('group', { name: 'Transition preview' })
    .getByRole('button', { name: 'Play', exact: true })
    .click();
  // First verify explicit playback completes the reduced-motion cut. The
  // following menu checks need a stable preview, not a race against its 400ms.
  await expectSelected(20, 'Chapter 20');
  await window.getByRole('button', { name: 'Koma 19: Chapter 19', exact: true }).click();
  const position = window.getByLabel('Position in the transition');
  await position.fill('500');
  await expect(position).toHaveAttribute('aria-valuetext', '50 percent');
  await expect(
    window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]'),
  ).toHaveAttribute('aria-label', 'Preview of the transition from Chapter 19 to Chapter 20');
  const duringPreview = await openKomaActions(window);
  await expect(
    duringPreview.getByRole('menuitem', { name: 'Move Koma left', exact: true }),
  ).toBeEnabled();
  await expect(
    duringPreview.getByRole('menuitem', { name: 'Move Koma right', exact: true }),
  ).toBeEnabled();
  await window.keyboard.press('Escape');
  dialog = await overview();
  await expect(dialog.getByLabel('Move to position')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Move Koma', exact: true })).toBeDisabled();
  await expect(dialog.getByText('Stop the preview before moving a Koma.')).toBeVisible();
  await dialog.getByLabel('Find a Koma').press('Escape');
  await expect(position).toHaveAttribute('aria-valuetext', '50 percent');
  await window.getByRole('button', { name: 'Stop preview', exact: true }).click();
  const actions = await openKomaActions(window);
  await expect(
    actions.getByRole('menuitem', { name: 'Move Koma left', exact: true }),
  ).toBeEnabled();
  await expect(
    actions.getByRole('menuitem', { name: 'Move Koma right', exact: true }),
  ).toBeEnabled();
  await expect(actions.getByRole('menuitem', { name: 'Delete Koma', exact: true })).toBeEnabled();
  await window.keyboard.press('Escape');
  await expect(window.getByRole('button', { name: 'Add Koma', exact: true })).toBeEnabled();
  await window.screenshot({
    path: test.info().outputPath('narrow-deck-selection.png'),
    scale: 'css',
  });
  expect(running.problems).toEqual([]);
});

for (const aspectRatio of ['16:9', '4:3'] as const) {
  test(`visual overview keeps search and move controls reachable in a short window (${aspectRatio})`, async () => {
    const { window, application } = running;
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 668);
    });
    await expect
      .poll(() => window.evaluate(() => ({ width: innerWidth, height: innerHeight })))
      .toEqual({ width: 1120, height: 668 });
    await window.emulateMedia({ reducedMotion: 'reduce' });
    const fixture = buildNavigationProject();
    const title = 'UnbrokenLongTitle'.repeat(15);
    await openLongDeck({
      ...fixture,
      presentation: {
        ...fixture.presentation,
        aspectRatio,
        komas: fixture.presentation.komas.map((koma, index) =>
          index === 99 ? { ...koma, title } : koma,
        ),
      },
    });
    const dialog = await overview();
    const results = dialog.getByRole('list', { name: 'Deck overview', exact: true });
    const current = results.getByRole('button', { name: 'Koma 1: Chapter 1', exact: true });
    await expect(current).toHaveAttribute('aria-current', 'true');
    await expect(current.getByText('Selected', { exact: true })).toBeVisible();
    await expect(current.locator('[data-koma-stage]')).toBeVisible();
    await dialog.getByLabel('Find a Koma').press('Enter');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Find a Koma').press('Tab');
    await expect(current).toBeFocused();
    await current.press('Tab');
    await expect(dialog.getByLabel('Move to position')).toBeFocused();
    await dialog.getByLabel('Move to position').press('Shift+Tab');
    await current.press('ArrowUp');
    await expect(dialog.getByLabel('Find a Koma')).toBeFocused();
    await expect(
      results.getByRole('button', { name: 'Koma 2: Chapter 2', exact: true }),
    ).toContainText('Hold 1.2 s');
    await dialog.getByLabel('Find a Koma').press('ArrowDown');
    await window.keyboard.press('End');
    const last = results.getByRole('button', { name: `Koma 100: ${title}`, exact: true });
    await expect(last).toBeFocused();
    await expect(last).toBeInViewport({ ratio: 1 });
    await expect(last.locator('[data-koma-stage]')).toBeVisible();
    await expect(dialog.getByLabel('Find a Koma')).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByLabel('Move to position')).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: 'Close overview' })).toBeInViewport({
      ratio: 1,
    });
    expect(
      await dialog.evaluate(
        (node) => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight,
      ),
    ).toBe(true);
    await window.screenshot({
      path: test.info().outputPath(`overview-short-${aspectRatio.replace(':', '-')}.png`),
      scale: 'css',
    });
    await last.press('Enter');
    await expectSelected(100, title);
    const reopened = await overview();
    await expect(
      reopened.getByRole('button', { name: `Koma 100: ${title}`, exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await reopened.getByLabel('Find a Koma').press('Enter');
    await expect(reopened).toBeVisible();
    await reopened.getByLabel('Find a Koma').press('ArrowDown');
    await expect(
      reopened.getByRole('button', { name: `Koma 100: ${title}`, exact: true }),
    ).toBeFocused();
    await expect(
      reopened.getByText(`Selected: Koma 100 — ${title}`, { exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await reopened.getByLabel('Find a Koma').fill('no matching metadata');
    await expect(reopened.getByText('No Komas match this search.')).toBeVisible();
    await expect(reopened.getByRole('button', { name: 'Close overview' })).toBeInViewport({
      ratio: 1,
    });
    await reopened.getByRole('button', { name: 'Close overview' }).click();
    await expect(window.getByRole('button', { name: /^Deck overview/ })).toBeFocused();
    await expect(window.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    expect(running.problems).toEqual([]);
  });
}

test('moves first to last and back, moves a middle Koma, and retains holds and adjacent motion through undo, redo and save/reopen', async () => {
  test.setTimeout(120_000);
  const { window, application } = running;
  const { source, project } = await openLongDeck();
  let dialog = await overview();
  for (const invalid of ['0', '101', '1.5', '-1', 'not a position']) {
    await dialog.getByLabel('Move to position').fill(invalid);
    await expect(dialog.getByRole('button', { name: 'Move Koma', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('alert')).toContainText('Enter a whole position from 1 to 100.');
    await dialog.getByLabel('Move to position').press('Enter');
    await expect(dialog.getByText('Selected: Koma 1 — Chapter 1')).toBeVisible();
  }
  await dialog.getByLabel('Move to position').fill('1');
  await expect(dialog.getByRole('button', { name: 'Move Koma', exact: true })).toBeDisabled();
  await dialog.getByLabel('Find a Koma').press('Escape');
  await expect(window.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();

  dialog = await overview();
  await dialog.getByLabel('Move to position').fill('100');
  await dialog.getByLabel('Move to position').press('Enter');
  await expect(dialog.getByText('Selected: Koma 100 — Chapter 1')).toBeVisible();
  await dialog.getByLabel('Find a Koma').press('Escape');
  await expectSelected(100, 'Chapter 1');
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectSelected(1, 'Chapter 1');
  await expect(window.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await window.getByRole('button', { name: 'Redo', exact: true }).click();
  await expectSelected(100, 'Chapter 1');
  const last = await saveAndRead(source);
  expectPreserved(project, last);
  expect(last.presentation.komas[99]?.id).toBe('koma-1');

  dialog = await overview();
  await dialog.getByLabel('Move to position').fill('1');
  await dialog.getByRole('button', { name: 'Move Koma', exact: true }).click();
  await dialog.getByLabel('Find a Koma').press('Escape');
  await expectSelected(1, 'Chapter 1');
  const first = await saveAndRead(source);
  expectPreserved(last, first);
  expect(first.presentation.komas.map((koma) => koma.id)).toEqual(
    project.presentation.komas.map((koma) => koma.id),
  );

  dialog = await overview();
  await dialog.getByLabel('Find a Koma').fill('quarterly revenue');
  await dialog.getByLabel('Find a Koma').press('Enter');
  await expectSelected(50, 'Chapter 50');
  dialog = await overview();
  await dialog.getByLabel('Move to position').fill('75');
  await dialog.getByRole('button', { name: 'Move Koma', exact: true }).click();
  await expect(dialog.getByText('Selected: Koma 75 — Chapter 50')).toBeVisible();
  await window.screenshot({
    path: test.info().outputPath('overview-moved-middle.png'),
    scale: 'css',
  });
  await dialog.getByLabel('Find a Koma').press('Escape');
  await expectSelected(75, 'Chapter 50');
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectSelected(50, 'Chapter 50');
  await window.getByRole('button', { name: 'Redo', exact: true }).click();
  await expectSelected(75, 'Chapter 50');
  const middle = await saveAndRead(source);
  expectPreserved(first, middle);
  expect(middle.presentation.komas[74]?.holdDurationMs).toBe(6000);
  await answerOpenDialog(application, source);
  await chooseProjectCommand(window, 'Open');
  await expect(window.getByLabel('Project name')).toHaveValue(project.name);
  dialog = await overview();
  await dialog.getByLabel('Find a Koma').fill('quarterly revenue');
  await expect(
    dialog.getByRole('button', { name: 'Koma 75: Chapter 50', exact: true }),
  ).toBeVisible();
  await dialog.getByLabel('Find a Koma').press('Enter');
  await expectSelected(75, 'Chapter 50');
  const reopened = komaProjectSchema.parse(JSON.parse(await readFile(source, 'utf8')));
  expect(reopened.presentation).toEqual(middle.presentation);
  await window.screenshot({ path: test.info().outputPath('deck-reopened.png'), scale: 'css' });
  expect(running.problems).toEqual([]);
});
