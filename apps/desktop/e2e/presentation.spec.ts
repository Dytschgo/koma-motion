/// <reference lib="dom" />
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { KomaProject } from '@koma-motion/core';
import { buildKoma, buildPresentation, buildProject, buildShape } from '@koma-motion/core/testing';
import { buildTransition } from '@koma-motion/motion-engine';
import { serialiseProject } from '@koma-motion/project-format';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { answerOpenDialog, launchApplication, type RunningApplication } from './application';
import { modelTrigger, selectProvider } from './composerControls';

let running: RunningApplication;

test.beforeEach(async () => {
  running = await launchApplication();
});

test.afterEach(async () => {
  await running.close();
});

function player(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Presentation' });
}

function playerStage(page: Page): Locator {
  return player(page).locator('[data-koma-stage]');
}

function position(page: Page): Locator {
  return player(page).locator('[data-presentation-position]');
}

function controls(page: Page): Locator {
  return player(page).getByRole('group', { name: 'Presentation controls' });
}

function editorStage(page: Page): Locator {
  return page.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');
}

async function capture(page: Page, name: string): Promise<void> {
  const evidence = process.env['KOMA_EVIDENCE_DIR'];
  if (evidence !== undefined) {
    await page.screenshot({ path: join(evidence, `${name}.png`) });
  }
}

async function present(page: Page, from: 'From the beginning' | RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await page
    .getByRole('group', { name: 'Start the presentation' })
    .getByRole('button', { name: from })
    .click();
}

async function createGeneratedProject(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Create a project' }).click();
  await selectProvider(page, 'mock');
  await expect(modelTrigger(page)).toHaveAttribute(
    'aria-description',
    'Mock provider has no model choice',
  );
  await page.getByRole('button', { name: 'Use the example request' }).click();
  await page.getByRole('button', { name: 'Generate Komas' }).click();
  await expect(
    page.getByRole('list', { name: 'Komas' }).getByRole('button', { name: /^Koma \d:/ }),
  ).toHaveCount(3);
}

/**
 * Three Komas with a mover. The transition from "Middle" to "End" was made
 * before the mover in "End" moved again, so it is stale. With `stale: 'first'`
 * the first transition is stale instead.
 */
function deckWithStaleTransition(stale: 'first' | 'last'): KomaProject {
  const mover = buildShape({
    id: 'mover-1',
    persistentId: 'mover',
    name: 'Mover',
    position: { x: 120, y: 300 },
    size: { width: 200, height: 160 },
  });
  const at = (id: string, x: number) => ({ ...mover, id, position: { x, y: 300 } });
  const start = buildKoma({ id: 'koma-1', title: 'Start', elements: [at('mover-1', 120)] });
  const middle = buildKoma({ id: 'koma-2', title: 'Middle', elements: [at('mover-2', 600)] });
  const end = buildKoma({ id: 'koma-3', title: 'End', elements: [at('mover-3', 1000)] });
  const transition = (id: string, from: typeof start, to: typeof start) => {
    const built = buildTransition({
      id,
      from,
      to,
      suggestion: { easing: 'linear', duration: 1500 },
    });
    if (!built.ok) throw new Error('Expected a transition');
    return built.value.transition;
  };
  const transitions = [transition('t-1', start, middle), transition('t-2', middle, end)];
  const komas =
    stale === 'last'
      ? [start, middle, { ...end, elements: [at('mover-3', 1500)] }]
      : [{ ...start, elements: [at('mover-1', 40)] }, middle, end];
  return buildProject({
    name: 'Presentation deck',
    presentation: buildPresentation({ komas, transitions }),
  });
}

async function openProject(project: KomaProject): Promise<void> {
  const { window, application, directory } = running;
  const result = serialiseProject(project);
  if (!result.ok) throw new Error(result.error.message);
  const filePath = join(directory, 'deck.koma');
  await writeFile(filePath, result.value);
  await answerOpenDialog(application, filePath);
  await window.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(window.getByLabel('Project name')).toHaveValue(project.name);
}

async function isFullScreen(): Promise<boolean> {
  return running.application.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen() ?? false,
  );
}

test('plays every Koma with its transitions, from the keyboard, and exits with Escape', async () => {
  const { window, problems } = running;
  await createGeneratedProject(window);
  // A long transition, so that pausing it can be observed.
  await window.getByLabel('Transition duration in seconds').fill('6');

  // The single-transition preview is still there and separate.
  await expect(window.getByRole('button', { name: 'Preview', exact: true })).toBeEnabled();
  await window.keyboard.press('F5');
  const dialog = player(window);
  await expect(dialog).toBeVisible();
  await expect(position(window)).toHaveText('1 of 3');
  await expect(playerStage(window)).toHaveAttribute('aria-label', /^Koma 1 of 3: /);
  await expect(controls(window).getByRole('button', { name: 'Next' })).toBeFocused();
  // Nothing in the player edits the Koma.
  await expect(dialog.locator('[data-koma-handle], [data-selected="true"]')).toHaveCount(0);
  await capture(window, 'presentation-koma-1');

  await window.keyboard.press('ArrowRight');
  await expect(playerStage(window)).toHaveAttribute('aria-label', /^Transition from /);
  await expect(position(window)).toHaveText('2 of 3');
  await window.keyboard.press('k');
  const pause = controls(window).getByRole('button', { name: 'Resume' });
  await expect(pause).toBeVisible();
  const paused = await playerStage(window).screenshot();
  await window.waitForTimeout(600);
  expect(await playerStage(window).screenshot()).toEqual(paused);
  await capture(window, 'presentation-paused-transition');
  await pause.click();
  await expect(controls(window).getByRole('button', { name: 'Pause' })).toBeVisible();

  // Next during a transition arrives at once.
  await controls(window).getByRole('button', { name: 'Next' }).focus();
  await window.keyboard.press('Space');
  await expect(playerStage(window)).toHaveAttribute('aria-label', /^Koma 2 of 3: /);

  await window.keyboard.press('r');
  await expect(playerStage(window)).toHaveAttribute('aria-label', /^Transition from /);
  await window.keyboard.press('PageDown');
  await expect(playerStage(window)).toHaveAttribute('aria-label', /^Koma 2 of 3: /);

  await window.keyboard.press('End');
  await expect(position(window)).toHaveText('3 of 3');
  await expect(controls(window)).toContainText('End');
  await expect(controls(window).getByRole('button', { name: 'Next' })).toBeDisabled();
  await window.keyboard.press('ArrowLeft');
  await expect(position(window)).toHaveText('2 of 3');
  await window.keyboard.press('Home');
  await expect(position(window)).toHaveText('1 of 3');
  await expect(controls(window).getByRole('button', { name: 'Previous' })).toBeDisabled();

  // Every enabled control is reachable with Tab; disabled ones are skipped.
  const names = new Set<string>();
  for (let index = 0; index < 8; index += 1) {
    await window.keyboard.press('Tab');
    names.add(
      await window.evaluate(() => {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement) return active.labels?.[0]?.textContent ?? '';
        return active?.getAttribute('aria-label') ?? active?.textContent?.trim() ?? '';
      }),
    );
  }
  expect([...names].sort()).toEqual(['Autoplay', 'Exit', 'Full screen', 'Next', 'Shortcuts']);
  await window.keyboard.press('?');
  const shortcuts = player(window).getByRole('region', { name: 'Presentation shortcuts' });
  await expect(shortcuts).toContainText('Exit the presentation');
  await capture(window, 'presentation-shortcuts');

  await window.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(editorStage(window)).toBeVisible();
  await expect(window.getByRole('group', { name: 'Transition preview' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('starts from the selected Koma, autoplays to the end and goes full screen', async () => {
  const { window, problems } = running;
  await createGeneratedProject(window);
  await window.getByRole('button', { name: /^Koma 2:/ }).click();
  await present(window, /^From Koma 2/);
  await expect(position(window)).toHaveText('2 of 3');

  await controls(window).getByRole('button', { name: 'Full screen' }).click();
  await expect.poll(isFullScreen).toBe(true);
  await expect(controls(window).getByRole('button', { name: 'Leave full screen' })).toBeVisible();
  await capture(window, 'presentation-full-screen');

  await expect(controls(window).getByLabel('Seconds on each Koma')).toBeDisabled();
  await controls(window).getByRole('switch', { name: 'Autoplay' }).check();
  await controls(window).getByLabel('Seconds on each Koma').fill('1');
  await expect(position(window)).toHaveText('3 of 3');
  await expect(playerStage(window)).toHaveAttribute('aria-label', /^Koma 3 of 3: /, {
    timeout: 15_000,
  });
  await expect(controls(window)).toContainText('End');

  await window.keyboard.press('Escape');
  await expect(player(window)).toHaveCount(0);
  await expect.poll(isFullScreen).toBe(false);
  expect(problems).toEqual([]);
});

test('reviews transitions that cannot play: return to edit, or cut across them by name', async () => {
  const { window, problems } = running;
  await openProject(deckWithStaleTransition('last'));

  await present(window, 'From the beginning');
  const review = window.getByRole('dialog', { name: '1 transition cannot play' });
  await expect(review).toBeVisible();
  const listed = review.getByRole('list', { name: 'Transitions that cannot play' });
  await expect(listed.getByRole('listitem')).toHaveCount(1);
  await expect(listed).toContainText('Koma 2 to Koma 3: “Middle” to “End”');
  await expect(listed).toContainText('Out of date');
  await capture(window, 'presentation-review');

  // Returning to edit opens the Koma whose transition needs repair.
  await review.getByRole('button', { name: 'Return to edit' }).click();
  await expect(review).toHaveCount(0);
  await expect(editorStage(window)).toHaveAttribute('aria-label', 'Koma 2: Middle');
  await expect(window.getByRole('region', { name: /Transition 2 to 3\./ })).toBeVisible();

  await present(window, 'From the beginning');
  await window
    .getByRole('dialog', { name: '1 transition cannot play' })
    .getByRole('button', { name: 'Present and cut across it' })
    .click();
  await expect(position(window)).toHaveText('1 of 3');
  await window.keyboard.press('ArrowRight');
  await expect(playerStage(window)).toHaveAttribute(
    'aria-label',
    'Transition from Start to Middle',
  );
  await expect(playerStage(window)).toHaveAttribute('aria-label', 'Koma 2 of 3: Middle');
  // The stale transition is cut, never played.
  await window.keyboard.press('ArrowRight');
  await expect(playerStage(window)).toHaveAttribute('aria-label', 'Koma 3 of 3: End');
  await window.keyboard.press('r');
  await expect(playerStage(window)).toHaveAttribute('aria-label', 'Koma 3 of 3: End');
  await expect(
    controls(window).getByRole('button', { name: 'Replay the transition' }),
  ).toBeDisabled();
  await window.keyboard.press('Escape');
  expect(problems).toEqual([]);
});

test('stops at a transition that cannot play when it was not reviewed', async () => {
  const { window, problems } = running;
  await openProject(deckWithStaleTransition('first'));
  await window.getByRole('button', { name: /^Koma 2:/ }).click();
  // Nothing after Koma 2 is wrong, so there is no review.
  await present(window, /^From Koma 2/);
  await expect(position(window)).toHaveText('2 of 3');
  await window.keyboard.press('ArrowLeft');
  await expect(position(window)).toHaveText('1 of 3');

  await window.keyboard.press('ArrowRight');
  const prompt = player(window).getByRole('region', {
    name: 'The transition to Koma 2 cannot play',
  });
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('“Start” to “Middle”: Out of date.');
  await expect(position(window)).toHaveText('1 of 3');
  await capture(window, 'presentation-halted');
  // Next does not cross it.
  await window.keyboard.press('ArrowRight');
  await expect(position(window)).toHaveText('1 of 3');

  // The choice is made from the keyboard; the focus stays on it.
  const cut = prompt.getByRole('button', { name: 'Cut to Koma 2' });
  await cut.focus();
  await window.waitForTimeout(300);
  await expect(cut).toBeFocused();
  await window.keyboard.press('Enter');
  await expect(prompt).toHaveCount(0);
  await expect(playerStage(window)).toHaveAttribute('aria-label', 'Koma 2 of 3: Middle');
  // Once chosen, the same cut is not asked again.
  await window.keyboard.press('ArrowLeft');
  await window.keyboard.press('ArrowRight');
  await expect(playerStage(window)).toHaveAttribute('aria-label', 'Koma 2 of 3: Middle');

  await window.keyboard.press('ArrowLeft');
  await expect(position(window)).toHaveText('1 of 3');
  await player(window).getByRole('button', { name: 'Exit' }).click();
  await expect(player(window)).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('follows undo and redo of Komas during a presentation and refuses an empty one', async () => {
  const { window, problems } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await expect(window.getByRole('button', { name: 'Present', exact: true })).toBeDisabled();
  await window.keyboard.press('F5');
  await expect(player(window)).toHaveCount(0);
  await expect(window.getByRole('status').filter({ hasText: 'nothing to present' })).toBeVisible();

  await window.getByRole('button', { name: 'Add Koma' }).click();
  await window.getByRole('button', { name: 'Add Koma' }).click();
  await expect(window.getByRole('button', { name: /^Koma 2:/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await window.keyboard.press('Shift+F5');
  await expect(position(window)).toHaveText('2 of 2');

  // Undo deletes the Koma on screen; the player moves to the one that remains.
  await window.keyboard.press('Control+z');
  await expect(position(window)).toHaveText('1 of 1');
  await window.keyboard.press('Control+y');
  await expect(position(window)).toHaveText('1 of 2');
  await window.keyboard.press('ArrowRight');
  await expect(position(window)).toHaveText('2 of 2');

  // Undoing every Koma ends the presentation instead of showing nothing.
  await window.keyboard.press('Control+z');
  await window.keyboard.press('Control+z');
  await expect(player(window)).toHaveCount(0);
  await expect(
    window
      .getByRole('status')
      .filter({ hasText: 'The presentation ended because it has no Komas.' }),
  ).toBeVisible();
  expect(problems).toEqual([]);
});

test('keeps every control usable at the minimum window size', async () => {
  const { window, application, problems } = running;
  await createGeneratedProject(window);
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 700);
  });
  await expect.poll(() => window.evaluate(() => innerWidth)).toBeLessThanOrEqual(1120);
  await present(window, 'From the beginning');
  for (const name of ['Exit', 'Previous', 'Pause', 'Next', 'Replay the transition', 'Shortcuts']) {
    await expect(controls(window).getByRole('button', { name, exact: true })).toBeInViewport({
      ratio: 1,
    });
  }
  await expect(controls(window).getByRole('switch', { name: 'Autoplay' })).toBeInViewport();
  await expect(controls(window).getByLabel('Seconds on each Koma')).toBeInViewport({ ratio: 1 });
  await expect(controls(window).getByRole('button', { name: 'Full screen' })).toBeInViewport({
    ratio: 1,
  });
  const box = await playerStage(window).boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(400);
  await capture(window, 'presentation-1120x700');
  await window.keyboard.press('Escape');
  expect(problems).toEqual([]);
});

test('cuts instead of moving with reduced motion', async () => {
  const { window, problems } = running;
  await window.emulateMedia({ reducedMotion: 'reduce' });
  await createGeneratedProject(window);
  await present(window, 'From the beginning');
  await window.keyboard.press('ArrowRight');
  await expect(playerStage(window)).toHaveAttribute('aria-label', /^Koma 2 of 3: /);
  await expect(player(window).getByRole('note')).toContainText('Reduced motion is on');
  await window.keyboard.press('Escape');
  expect(problems).toEqual([]);
});
