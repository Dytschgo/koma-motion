import { chooseKomaAction } from './komaControls';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { komaProjectSchema } from '@koma-motion/core';
import { buildKoma, buildProject } from '@koma-motion/core/testing';
import { expect, test } from '@playwright/test';
import {
  answerOpenDialog,
  launchApplication,
  type RunningApplication,
  openSettingsPage,
  chooseProjectCommand,
  showGenerationOptions,
} from './application';
import { countTrigger, setKomaCount } from './composerControls';

let running: RunningApplication;
test.beforeEach(async () => {
  running = await launchApplication();
});
test.afterEach(async () => {
  await running.close();
});

for (const count of [250, 1000]) {
  test(`${String(count)} Komas support add, copy, reorder, undo, save and reopen`, async () => {
    test.setTimeout(120_000);
    const { application, directory, problems, window } = running;
    const filePath = join(directory, 'large.koma');
    const project = buildProject({
      presentation: {
        ...buildProject().presentation,
        komas: Array.from({ length: count }, (_, index) =>
          buildKoma({ id: `koma-${String(index + 1)}`, title: `Koma ${String(index + 1)}` }),
        ),
      },
    });
    await writeFile(filePath, JSON.stringify(project), 'utf8');
    await answerOpenDialog(application, filePath);
    const timings: Record<string, number> = {};
    let started = performance.now();
    await window.getByRole('button', { name: 'Open a project' }).click();
    const komas = window
      .getByRole('list', { name: 'Komas' })
      .getByRole('button', { name: /^Koma \d+:/ });
    await expect(komas).toHaveCount(count);
    timings.openMs = performance.now() - started;
    const add = window.getByRole('button', { name: 'Add Koma' });
    await expect(add).toBeEnabled();
    started = performance.now();
    await komas.last().click();
    await expect(komas.last()).toHaveAttribute('aria-current', 'true');
    timings.selectLastMs = performance.now() - started;
    started = performance.now();
    await add.click();
    await expect(komas).toHaveCount(count + 1);
    timings.copyMs = performance.now() - started;
    await chooseKomaAction(window, 'Move Koma left');
    await expect(komas.nth(count - 1)).toHaveAttribute('aria-current', 'true');
    await window.getByRole('button', { name: 'Undo', exact: true }).click();
    await window.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(komas).toHaveCount(count);
    await window.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(komas).toHaveCount(count + 1);
    started = performance.now();
    await chooseProjectCommand(window, 'Save');
    await expect(window.getByText('All changes saved')).toBeVisible();
    timings.saveMs = performance.now() - started;
    const saved = komaProjectSchema.parse(JSON.parse(await readFile(filePath, 'utf8')));
    expect(saved.presentation.komas).toHaveLength(count + 1);
    expect(saved.presentation.komas.at(-1)?.elements).toHaveLength(2);
    await chooseProjectCommand(window, 'New');
    await answerOpenDialog(application, filePath);
    await chooseProjectCommand(window, 'Open');
    await expect(komas).toHaveCount(count + 1);
    await expect(add).toBeEnabled();
    await setKomaCount(window, '30');
    await showGenerationOptions(window);
    await expect(countTrigger(window)).toHaveAttribute('aria-description', '30 Komas');
    const brief = 'Detailed request. '.repeat(300);
    await window.getByLabel('Your request').fill(brief);
    await expect(window.getByLabel('Your request')).toHaveValue(brief);
    await openSettingsPage(window, 'Generation');
    const deadline = window.getByLabel('Generation time limit', { exact: true });
    await expect(deadline).toHaveValue('none');
    await deadline.selectOption('7200');
    await expect(deadline).toHaveValue('7200');
    await deadline.selectOption('none');
    await window.getByRole('button', { name: 'Done', exact: true }).click();
    await window.screenshot({ path: test.info().outputPath('large-project.png') });
    await test.info().attach('timings', {
      body: JSON.stringify(timings, null, 2),
      contentType: 'application/json',
    });
    console.log(`${String(count)}-Koma presentation timings:`, timings);
    expect(problems).toEqual([]);
  });
}
