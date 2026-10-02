/// <reference lib="dom" />
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { KomaProject } from '@koma-motion/core';
import { buildKoma, buildPresentation, buildProject, buildShape } from '@koma-motion/core/testing';
import { buildTransition } from '@koma-motion/motion-engine';
import { serialiseProject } from '@koma-motion/project-format';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  answerOpenDialog,
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

const STALE_REASON =
  '"Start" or "End" changed after this motion was made, so it no longer matches "Mover".';

/**
 * Two Komas whose transition was made before the mover in "End" moved
 * further. Opening the file keeps the stored motion, which is now stale.
 */
function staleProject(extra: Partial<KomaProject> = {}): KomaProject {
  const mover = buildShape({
    id: 'mover-1',
    persistentId: 'mover',
    name: 'Mover',
    position: { x: 120, y: 300 },
    size: { width: 200, height: 160 },
  });
  const from = buildKoma({ id: 'koma-1', title: 'Start', elements: [mover] });
  const to = buildKoma({
    id: 'koma-2',
    title: 'End',
    elements: [{ ...mover, id: 'mover-2', position: { x: 600, y: 300 } }],
  });
  const built = buildTransition({ id: 'transition-1', from, to, suggestion: { easing: 'linear' } });
  if (!built.ok) throw new Error('Expected a transition');
  const moved = { ...to, elements: [{ ...mover, id: 'mover-2', position: { x: 1400, y: 300 } }] };
  return buildProject({
    name: 'Stale motion',
    presentation: buildPresentation({
      komas: [from, moved],
      transitions: [built.value.transition],
    }),
    ...extra,
  });
}

async function openStaleProject(project = staleProject()): Promise<string> {
  const { window, application, directory } = running;
  const result = serialiseProject(project);
  if (!result.ok) throw new Error(result.error.message);
  const filePath = join(directory, 'stale.koma');
  await writeFile(filePath, result.value);
  await answerOpenDialog(application, filePath);
  await window.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(window.getByLabel('Project name')).toHaveValue(project.name);
  return result.value;
}

function warning(window: Page): Locator {
  return window.getByRole('region', { name: /Transition 1 to 2\./ });
}

function stage(window: Page): Locator {
  return window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');
}

async function expectBlocked(window: Page): Promise<void> {
  const transport = window.getByRole('group', { name: 'Transition preview' });
  await expect(transport.getByRole('button', { name: 'Play' })).toBeDisabled();
  await expect(transport.getByRole('button', { name: 'Restart' })).toBeDisabled();
  await expect(transport.getByLabel('Position in the transition')).toBeDisabled();
  await expect(transport.getByText('Cannot play')).toBeVisible();
  await expect(window.getByRole('button', { name: 'Preview', exact: true })).toBeDisabled();
}

/** Replaces the regeneration handler of the main process with a fixed answer. */
async function answerRegeneration(outcome: Record<string, unknown>): Promise<void> {
  await running.application.evaluate(({ ipcMain }, answer) => {
    ipcMain.removeHandler('koma:providers:regenerate-transition');
    ipcMain.handle('koma:providers:regenerate-transition', (_event, request: unknown) => ({
      ...answer,
      transitionId: (request as { transitionId: string }).transitionId,
      diagnostics: {
        providerId: 'mock',
        startedAt: '2026-09-30T12:00:00.000Z',
        finishedAt: '2026-09-30T12:00:01.000Z',
        durationMs: 1000,
        promptTemplate: 'transition-regeneration@1',
        attempts: [],
      },
    }));
  }, outcome);
}

test('explains a stale transition, links its Komas and regenerates it from the keyboard', async () => {
  const { window, directory, problems } = running;
  const text = await openStaleProject();

  const strip = window.getByRole('complementary', { name: 'Project' });
  const panel = warning(window);
  await expect(panel).toBeVisible();
  await expect(strip.getByRole('region', { name: /Transition 1 to 2\./ })).toBeVisible();
  await expect(panel.getByText('Out of date', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Regenerate transition' })).toBeVisible();
  await expectBlocked(window);
  // The action sits on the transition, between the two Koma cards.
  const sourceCard = await strip.getByRole('button', { name: 'Koma 1: Start' }).boundingBox();
  const destinationCard = await strip.getByRole('button', { name: 'Koma 2: End' }).boundingBox();
  const regenerate = await panel
    .getByRole('button', { name: 'Regenerate transition' })
    .boundingBox();
  if (sourceCard === null || destinationCard === null || regenerate === null) {
    throw new Error('The transition action is not on screen');
  }
  expect(regenerate.y).toBeGreaterThanOrEqual(sourceCard.y + sourceCard.height - 1);
  expect(regenerate.y + regenerate.height).toBeLessThanOrEqual(destinationCard.y + 1);
  await expect(
    strip.getByRole('button', { name: 'Koma 1: Start' }).getByRole('button'),
  ).toHaveCount(0);
  // Transition problems are no longer repeated in the Inspector's project warnings.
  await showInspector(window);
  await expect(window.getByRole('heading', { name: /^Warnings/ })).toHaveCount(0);

  const details = panel.getByRole('button', { name: 'Details' });
  await details.focus();
  await window.keyboard.press('Enter');
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByRole('heading')).toContainText(
    'The transition from "Start" to "End" cannot play',
  );
  await expect(panel).toContainText(STALE_REASON);
  await expect(panel).toContainText('no longer matches the content of the Komas');

  await panel.getByRole('button', { name: 'Open destination Koma “End”' }).focus();
  await window.keyboard.press('Enter');
  await expect(stage(window)).toHaveAttribute('aria-label', 'Koma 2: End');
  await panel.getByRole('button', { name: 'Open source Koma “Start”' }).focus();
  await window.keyboard.press('Space');
  await expect(stage(window)).toHaveAttribute('aria-label', 'Koma 1: Start');

  await panel.getByRole('button', { name: 'Regenerate transition' }).focus();
  await window.keyboard.press('Enter');
  await expect(panel.getByRole('status')).toContainText('Regenerating with Mock provider');
  await expect(panel).toHaveCount(0);
  await expect(
    window.getByText('The transition from "Start" to "End" was regenerated and can play again.'),
  ).toBeVisible();

  // Playback is back, and the focus moved to it.
  const transport = window.getByRole('group', { name: 'Transition preview' });
  await expect(transport.getByRole('button', { name: 'Play' })).toBeEnabled();
  await expect(transport.getByRole('button', { name: 'Play' })).toBeFocused();
  await expect(window.getByRole('button', { name: 'Preview', exact: true })).toBeEnabled();
  await expect(
    window.getByRole('button', { name: 'Preview the transition from Koma 1 to Koma 2' }),
  ).toBeVisible();
  const atRest = await stage(window).locator('[data-persistent-id="mover"]').boundingBox();
  await transport.getByLabel('Position in the transition').fill('500');
  await expect(stage(window)).toHaveAttribute('aria-label', /^Preview of the transition/);
  const middle = await stage(window).locator('[data-persistent-id="mover"]').boundingBox();
  expect((middle?.x ?? 0) - (atRest?.x ?? 0)).toBeGreaterThan(30);

  const evidence = process.env['KOMA_EVIDENCE_DIR'];
  if (evidence !== undefined) {
    await window.screenshot({ path: join(evidence, 'transition-regenerated.png') });
  }
  // The file is changed only when the user saves; one undo brings the warning back.
  expect(await readFile(join(directory, 'stale.koma'), 'utf8')).toBe(text);
  await window.getByRole('button', { name: 'Stop preview' }).click();
  await window.getByRole('button', { name: 'Undo' }).click();
  await expect(warning(window)).toBeVisible();
  expect(problems).toEqual([]);
});

test('keeps the warning after cancellation and rejects a result when an endpoint changes', async () => {
  const { window, problems } = running;
  await openStaleProject();
  await showInspector(window);
  const panel = warning(window);

  await panel.getByRole('button', { name: 'Regenerate transition' }).click();
  await panel.getByRole('button', { name: 'Cancel regeneration' }).click();
  await expect(panel.getByRole('status')).toHaveText(
    'Regeneration was stopped. The transition was not changed. The transition still cannot play.',
  );
  await expectBlocked(window);

  // Editing the source Koma while the provider works makes its answer obsolete.
  await panel.getByRole('button', { name: 'Retry regeneration' }).click();
  await expect(panel.getByRole('status')).toContainText('Regenerating with Mock provider');
  await window.getByLabel('Title', { exact: true }).fill('Start, edited');
  await expect(panel.getByRole('status')).toContainText(
    '"Start, edited" changed while the transition was being regenerated. The result was discarded',
  );
  const details = panel.getByRole('button', { name: 'Details' });
  if ((await details.getAttribute('aria-expanded')) !== 'true') {
    await details.click();
  }
  await expect(panel.getByRole('heading')).toContainText('from "Start, edited" to "End"');
  await expectBlocked(window);
  await expect(window.getByLabel('Title', { exact: true })).toHaveValue('Start, edited');

  // Without further edits, the next attempt succeeds.
  await panel.getByRole('button', { name: 'Retry regeneration' }).click();
  await expect(panel).toHaveCount(0);
  await expect(window.getByLabel('Title', { exact: true })).toHaveValue('Start, edited');
  expect(problems).toEqual([]);
});

test('keeps the warning and offers a retry when the provider fails or answers invalidly', async () => {
  const { window, problems } = running;
  await openStaleProject();
  const panel = warning(window);

  await answerRegeneration({
    status: 'failed',
    error: {
      code: 'invalidResponse',
      message:
        'The response of the agent does not follow the required structure:\neasing: The easing "bounce" is not supported.',
      issues: [],
    },
  });
  await panel.getByRole('button', { name: 'Regenerate transition' }).click();
  await expect(panel.getByRole('status')).toHaveText(
    'Regeneration failed. The response of the agent does not follow the required structure: The transition still cannot play.',
  );
  await panel.getByRole('button', { name: 'Details' }).click();
  await expect(panel).toContainText('The easing "bounce" is not supported.');
  await expectBlocked(window);

  await answerRegeneration({
    status: 'failed',
    error: { code: 'providerUnavailable', message: 'Claude Code is not installed.', issues: [] },
  });
  await panel.getByRole('button', { name: 'Retry regeneration' }).click();
  await expect(panel.getByRole('status')).toHaveText(
    'Regeneration failed. Claude Code is not installed. The transition still cannot play.',
  );
  await expectBlocked(window);

  await answerRegeneration({
    status: 'succeeded',
    settings: { strategy: 'staged', duration: 1300, easing: 'easeOut', rationale: 'Redone.' },
    warnings: [],
  });
  await panel.getByRole('button', { name: 'Retry regeneration' }).click();
  await expect(panel).toHaveCount(0);
  await expect(
    window.getByRole('group', { name: 'Transition preview' }).getByRole('button', { name: 'Play' }),
  ).toBeEnabled();
  expect(problems).toEqual([]);
});

test('fits the warning and its actions into a narrow window', async () => {
  const { window, application, problems } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1024, 700);
  });
  await openStaleProject();
  const panel = warning(window);
  await panel.getByRole('button', { name: 'Details' }).click();
  const viewport = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const strip = await window.getByRole('complementary', { name: 'Project' }).boundingBox();
  if (strip === null) throw new Error('The Koma strip is not on screen');
  for (const name of [
    'Regenerate transition',
    'Open source Koma “Start”',
    'Open destination Koma “End”',
    'Details',
  ]) {
    const control = panel.getByRole('button', { name });
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? 0).toBeGreaterThanOrEqual(strip.x - 1);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(strip.x + strip.width + 1);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
  }
  // The warning lives in the strip, so it does not cover the canvas.
  const canvas = await window.getByRole('region', { name: 'Canvas' }).boundingBox();
  const panelBox = await panel.boundingBox();
  expect(canvas).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect((panelBox?.x ?? 0) + (panelBox?.width ?? 0)).toBeLessThanOrEqual((canvas?.x ?? 0) + 1);
  const evidence = process.env['KOMA_EVIDENCE_DIR'];
  if (evidence !== undefined) {
    await window.screenshot({ path: join(evidence, 'transition-warning-narrow.png') });
  }
  expect(problems).toEqual([]);
});

test('keeps asset recovery in Project health and motion recovery beside the canvas', async () => {
  const { window, problems } = running;
  const base = staleProject();
  const [start, end] = base.presentation.komas;
  if (start === undefined || end === undefined) throw new Error('Expected two Komas');
  await openStaleProject({
    ...base,
    brandKit: { ...base.brandKit, logoAssetId: 'asset-gone' },
  });
  await expect(warning(window)).toBeVisible();
  await window.getByRole('button', { name: /^Project health/ }).click();
  const health = window.getByRole('dialog', { name: 'Project health', exact: true });
  await expect(health).toContainText(
    'The Brand Kit logo image is unavailable (asset "asset-gone").',
  );
  await expect(health.getByRole('button', { name: 'Replace logo' })).toBeVisible();
  await health.getByRole('button', { name: 'Close', exact: true }).click();
  await showInspector(window);
  await window.getByRole('tab', { name: /^Motion/ }).click();
  await expect(
    window.getByRole('button', { name: 'Recalculate motion', exact: true }),
  ).toBeVisible();
  await window.getByRole('button', { name: 'Recalculate motion', exact: true }).click();
  await expect(warning(window)).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(warning(window)).toBeVisible();
  await expect(window.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  expect(problems).toEqual([]);
});
