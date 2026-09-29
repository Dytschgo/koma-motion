/**
 * Runs the application with an agent CLI that is installed on this computer.
 * It only runs on request, because it uses the account of the person who runs it:
 *
 *   KOMA_LIVE_E2E=claude-code KOMA_LIVE_MODEL=<model> pnpm test:e2e live
 */
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { answerSaveDialog, launchApplication } from './application';

const provider = process.env['KOMA_LIVE_E2E'] ?? '';
const model = process.env['KOMA_LIVE_MODEL'] ?? '';
const OUTPUT_DIRECTORY = resolve(import.meta.dirname, '../test-results/live');

test.skip(provider !== 'claude-code', 'Live tests run on request');
test.setTimeout(11 * 60_000);

test('generates a presentation with Claude Code', async () => {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const running = await launchApplication();
  const { window, application } = running;
  const filePath = join(OUTPUT_DIRECTORY, 'claude-code.koma');

  try {
    await window.getByRole('button', { name: 'Create a project' }).click();
    await window.getByLabel('Project name').fill('Generated with Claude Code');

    if (model !== '') {
      await window.getByRole('button', { name: 'Settings' }).click();
      await window.getByLabel('Model for Claude Code').fill(model);
      await window.getByRole('button', { name: 'Done' }).click();
    }

    await window.getByLabel('Provider').selectOption('claude-code');
    await expect(window.getByText(/^Available: Version/)).toBeVisible();

    await window.getByLabel('Komas', { exact: true }).selectOption('3');
    await window
      .getByLabel('Your request')
      .fill(
        'Create a three-frame presentation introducing Koma Motion. Start with the complete system, focus on the motion engine, then reveal how the result stays editable. Keep it simple: at most 8 elements per frame.',
      );
    await window.getByRole('button', { name: 'Generate Komas' }).click();
    await expect(window.getByRole('button', { name: 'Cancel' })).toBeVisible();

    const komas = window
      .getByRole('list', { name: 'Komas' })
      .getByRole('button', { name: /^Koma \d:/ });
    const failure = window.getByText(/^Generation (failed|stopped|took too long)$/);
    await expect(komas.first().or(failure)).toBeVisible({ timeout: 10 * 60_000 });
    await window.screenshot({ path: join(OUTPUT_DIRECTORY, 'result.png') });
    await expect(failure).toHaveCount(0);
    await expect(komas).toHaveCount(3);

    for (const index of [2, 3]) {
      await komas.nth(index - 1).click();
      await window.screenshot({ path: join(OUTPUT_DIRECTORY, `koma-${String(index)}.png`) });
    }

    await answerSaveDialog(application, filePath);
    await window.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(window.getByText('All changes saved')).toBeVisible();
    const saved: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    expect(saved).toMatchObject({
      agentConfiguration: { selectedProviderId: 'claude-code' },
      generationHistory: [{ providerId: 'claude-code', status: 'succeeded' }],
    });
  } finally {
    await running.close();
  }
});
