import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { komaProjectSchema } from '@koma-motion/core';
import { buildKoma, buildPresentation, buildProject, buildShape } from '@koma-motion/core/testing';
import { buildTransition } from '@koma-motion/motion-engine';
import { expect, test } from '@playwright/test';
import {
  answerOpenDialog,
  answerSaveDialog,
  launchApplication,
  showChat,
  showInspector,
  type RunningApplication,
} from './application';

let running: RunningApplication;
const komas = ['First', 'Middle', 'Last'].map((title, index) =>
  buildKoma({
    id: `koma-${String(index)}`,
    title,
    holdDurationMs: index === 1 ? 2500 : null,
    elements: [
      buildShape({
        id: `shape-${String(index)}`,
        persistentId: 'continuing',
        position: { x: 100 + index * 300, y: 100 },
      }),
    ],
  }),
);
const transitions = komas.slice(0, -1).map((from, index) => {
  const built = buildTransition({
    id: `motion-${String(index)}`,
    from,
    to: komas[index + 1]!,
    suggestion: { duration: 1000 },
  });
  if (!built.ok) throw new Error('Expected fixture motion');
  return built.value.transition;
});
const project = buildProject({
  name: 'Scoped proposal fixture',
  presentation: buildPresentation({ title: 'Saved deck metadata', komas, transitions }),
});
let source: string;
test.beforeEach(async () => {
  running = await launchApplication({ env: { KOMA_MOCK_DELAY_MS: '3000' } });
  source = join(running.directory, 'source.koma');
  await writeFile(source, JSON.stringify(project));
  await answerOpenDialog(running.application, source);
  await running.window.getByRole('button', { name: 'Open', exact: true }).click();
  await running.window.getByRole('button', { name: 'Koma 2: Middle', exact: true }).click();
  await showChat(running.window);
  await running.window.getByLabel('Generation scope').selectOption('selected');
});
test.afterEach(async () => {
  await running.close();
});
async function generate() {
  await running.window.getByLabel('Your request').fill('Improve only the selected middle Koma.');
  await running.window.getByRole('button', { name: 'Generate Komas', exact: true }).click();
}

test('reviews a middle Koma, discards unchanged, applies in one undo and saves/reopens with holds and neighboring motion intact', async () => {
  const { window, application, directory } = running;
  await expect(window.getByRole('button', { name: 'Koma count', exact: true })).toBeDisabled();
  await generate();
  const proposal = window.getByRole('region', { name: 'Selected Koma proposal' });
  await expect(proposal).toBeVisible();
  await expect(window.getByRole('button', { name: 'Koma 2: Middle', exact: true })).toBeVisible();
  await expect(window.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await proposal.getByRole('button', { name: 'Discard proposal' }).click();
  await expect(window.getByLabel('Your request')).toBeFocused();
  await expect(window.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await generate();
  await expect(proposal).toBeVisible();
  await window.screenshot({ path: test.info().outputPath('selected-proposal-preview.png') });
  await proposal.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(
    window.getByRole('button', { name: 'Koma 2: Revised: Middle', exact: true }),
  ).toBeVisible();
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(window.getByRole('button', { name: 'Koma 2: Middle', exact: true })).toBeVisible();
  await expect(window.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await window.getByRole('button', { name: 'Redo', exact: true }).click();
  const savedPath = join(directory, 'selected.koma');
  await answerSaveDialog(application, savedPath);
  await window.getByRole('button', { name: 'Save as', exact: true }).click();
  await expect(window.getByText('All changes saved', { exact: true })).toBeVisible();
  const saved = komaProjectSchema.parse(JSON.parse(await readFile(savedPath, 'utf8')));
  expect(saved.presentation.komas[0]).toEqual(komas[0]);
  expect(saved.presentation.komas[2]).toEqual(komas[2]);
  expect(saved.presentation.komas[1]).toMatchObject({
    id: 'koma-1',
    title: 'Revised: Middle',
    holdDurationMs: 2500,
  });
  expect(saved.presentation.transitions).toEqual(transitions);
  expect(saved.presentation.title).toBe(project.presentation.title);
  expect(saved.assets).toEqual(project.assets);
  expect(saved.generationHistory).toHaveLength(1);
  expect(await readFile(source, 'utf8')).toBe(JSON.stringify(project));
  await answerOpenDialog(application, savedPath);
  await window.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(
    window.getByRole('button', { name: 'Koma 2: Revised: Middle', exact: true }),
  ).toBeVisible();
  expect(running.problems).toEqual([]);
});

test('rejects target edits, clears proposals on same-file reopen, and cancellation leaves no change', async () => {
  const { window, application } = running;
  await generate();
  await showInspector(window);
  await window.getByLabel('Title', { exact: true }).fill('Edited during generation');
  await showChat(window);
  const proposal = window.getByRole('region', { name: 'Selected Koma proposal' });
  await expect(proposal.getByRole('alert')).toContainText('target Koma changed');
  await expect(proposal.getByRole('button', { name: 'Apply proposal' })).toBeDisabled();
  await proposal.getByRole('button', { name: 'Discard proposal' }).click();
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await generate();
  await expect(proposal).toBeVisible();
  await answerOpenDialog(application, source);
  await window.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(proposal).toHaveCount(0);
  await window.getByRole('button', { name: 'Koma 2: Middle', exact: true }).click();
  await showChat(window);
  await window.getByLabel('Generation scope').selectOption('selected');
  await generate();
  await window.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(window.getByRole('button', { name: 'Generate Komas', exact: true })).toBeVisible();
  await expect(proposal).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(window.getByRole('button', { name: 'Koma 2: Middle', exact: true })).toBeVisible();
  expect(running.problems).toEqual([]);
});

test('keeps proposal actions and draft focus usable in a narrow window', async () => {
  const { window, application } = running;
  await application.evaluate(({ BrowserWindow }) => {
    const native = BrowserWindow.getAllWindows()[0];
    native?.setMinimumSize(800, 600);
    native?.setContentSize(1024, 700);
  });
  await showChat(window);
  await generate();
  const proposal = window.getByRole('region', { name: 'Selected Koma proposal' });
  await expect(proposal.getByRole('button', { name: 'Discard proposal' })).toBeInViewport({
    ratio: 1,
  });
  await proposal.getByRole('button', { name: 'Discard proposal' }).click();
  await expect(window.getByLabel('Your request')).toBeFocused();
  await window.getByLabel('Your request').pressSequentially('A draft stays editable');
  await expect(window.getByLabel('Your request')).toHaveValue('A draft stays editable');
  await window.screenshot({ path: test.info().outputPath('selected-narrow-focus.png') });
  expect(running.problems).toEqual([]);
});
