import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  isWideWindow,
  launchApplication,
  showChat,
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

async function completeGenerationWithEdits(): Promise<void> {
  const { window } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await window.getByLabel('Your request').fill('Create three Komas about the motion engine.');
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  await window.getByRole('button', { name: 'Add Koma' }).click();
  await showInspector(window);
  await window.getByLabel('Title', { exact: true }).fill('My work in progress');
  await expect(window.getByRole('dialog', { name: 'Replace your edited Komas?' })).toBeVisible();
  // A narrow window hides the chat to show the Inspector, and the dialog keeps it hidden.
  if (await isWideWindow(window)) {
    await expect(window.getByText('Generation complete. Waiting for your decision')).toBeVisible();
  }
}

test('keeps edits when a completed generation is declined', async () => {
  const { window, problems } = running;
  await completeGenerationWithEdits();
  const dialog = window.getByRole('dialog', { name: 'Replace your edited Komas?' });
  await expect(dialog).toContainText('Keep editing discards the generated Komas.');
  const evidenceDirectory = process.env['KOMA_EVIDENCE_DIR'];
  if (evidenceDirectory !== undefined) {
    await window.screenshot({ path: join(evidenceDirectory, 'generation-conflict.png') });
  }
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await showChat(window);
  await expect(window.getByRole('button', { name: 'Koma 1: My work in progress' })).toBeVisible();
  await expect(window.getByText('Generated Komas were not applied')).toBeVisible();
  await expect(window.getByText('Your edits remain in the presentation.')).toBeVisible();
  expect(problems).toEqual([]);
});

test('replaces edits only after explicit confirmation and can undo back to them', async () => {
  const { window, problems } = running;
  await completeGenerationWithEdits();
  await window
    .getByRole('dialog', { name: 'Replace your edited Komas?' })
    .getByRole('button', { name: 'Replace Komas' })
    .click();
  await showChat(window);
  await expect(
    window.getByRole('list', { name: 'Komas' }).getByRole('button', { name: /^Koma \d:/ }),
  ).toHaveCount(3);
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
  await window.getByRole('button', { name: 'Undo' }).click();
  await expect(window.getByRole('button', { name: 'Koma 1: My work in progress' })).toBeVisible();
  expect(problems).toEqual([]);
});
