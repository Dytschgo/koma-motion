import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_KOMAS, komaProjectSchema } from '@koma-motion/core';
import { buildKoma, buildProject } from '@koma-motion/core/testing';
import { expect, test } from '@playwright/test';
import { answerOpenDialog, launchApplication, type RunningApplication } from './application';

let running: RunningApplication;

test.beforeEach(async () => {
  running = await launchApplication();
});

test.afterEach(async () => {
  await running.close();
});

test('a full project stays saveable and add becomes available after undo', async () => {
  test.setTimeout(120_000);
  const { application, directory, problems, window } = running;
  const filePath = join(directory, 'full.koma');
  const project = buildProject({
    presentation: {
      ...buildProject().presentation,
      komas: Array.from({ length: MAX_KOMAS }, (_, index) =>
        buildKoma({
          id: `koma-${String(index + 1)}`,
          title: `Koma ${String(index + 1)}`,
          elements: [],
        }),
      ),
    },
  });
  expect(komaProjectSchema.safeParse(project).success).toBe(true);
  await writeFile(filePath, JSON.stringify(project), 'utf8');

  await answerOpenDialog(application, filePath);
  await window.getByRole('button', { name: 'Open a project' }).click();
  const komas = window
    .getByRole('list', { name: 'Komas' })
    .getByRole('button', { name: /^Koma \d+:/ });
  await expect(komas).toHaveCount(MAX_KOMAS);
  const add = window.getByRole('button', { name: 'Add Koma' });
  await expect(add).toBeDisabled();
  await expect(add).toHaveAttribute('aria-describedby', 'koma-limit-message');
  await expect(window.locator('#koma-limit-message')).toHaveText(
    `A project can have up to ${String(MAX_KOMAS)} Komas. Delete one to add another.`,
  );
  await window.screenshot({ path: test.info().outputPath('koma-limit.png') });

  await window.getByLabel('Project name').fill('Full project saved');
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('All changes saved')).toBeVisible();
  const saved: unknown = JSON.parse(await readFile(filePath, 'utf8'));
  const parsed = komaProjectSchema.parse(saved);
  expect(parsed.presentation.komas).toHaveLength(MAX_KOMAS);
  expect(parsed.name).toBe('Full project saved');

  await window.getByRole('button', { name: 'New', exact: true }).click();
  await answerOpenDialog(application, filePath);
  await window.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(komas).toHaveCount(MAX_KOMAS);
  await expect(add).toBeDisabled();

  await window.getByRole('button', { name: 'Koma 1: Koma 1' }).click();
  await window.getByRole('button', { name: 'Delete Koma', exact: true }).click();
  await window.getByRole('dialog').getByRole('button', { name: 'Delete Koma' }).click();
  await expect(komas).toHaveCount(MAX_KOMAS - 1);
  await expect(add).toBeEnabled();
  await add.click();
  await expect(komas).toHaveCount(MAX_KOMAS);
  await expect(add).toBeDisabled();
  await window.getByRole('button', { name: 'Undo' }).click();
  await expect(komas).toHaveCount(MAX_KOMAS - 1);
  await expect(add).toBeEnabled();
  expect(problems).toEqual([]);
});
