/**
 * Creates the screenshots of the documentation. It only runs on request:
 *
 *   KOMA_SCREENSHOTS=1 pnpm test:e2e screenshots
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApplication } from './application';

const OUTPUT_DIRECTORY = resolve(import.meta.dirname, '../../../docs/screenshots');

test.skip(process.env['KOMA_SCREENSHOTS'] !== '1', 'Screenshots are created on request');

test('documentation screenshots', async () => {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const running = await launchApplication();
  const { window, application } = running;
  const capture = (name: string): Promise<Buffer> =>
    window.screenshot({ path: resolve(OUTPUT_DIRECTORY, `${name}.png`) });

  try {
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1480, 920);
    });
    await expect(window.getByRole('heading', { name: /Presentations are frames/ })).toBeVisible();
    await capture('welcome');

    await window.getByRole('button', { name: 'Create a project' }).click();
    await window.getByLabel('Project name').fill('Introducing Koma Motion');
    await window.getByRole('button', { name: 'Use the example request' }).click();
    await capture('empty-project');

    await window.getByRole('button', { name: 'Generate Komas' }).click();
    await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
    await capture('generated');

    await window.getByRole('button', { name: 'Koma 2: The motion engine' }).click();
    await window
      .getByRole('region', { name: 'Canvas' })
      .getByRole('button', { name: 'Motion engine (shape)' })
      .click();
    await capture('inspector');

    await window.getByRole('button', { name: 'Koma 1: One connected system' }).click();
    await window.getByLabel('Position in the transition').fill('520');
    await expect(
      window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]'),
    ).toHaveAttribute('aria-label', /^Preview of the transition/);
    await capture('transition-preview');

    await window.getByRole('button', { name: 'Brand Kit', exact: true }).click();
    await capture('brand-kit');

    await window.getByRole('button', { name: 'Settings' }).click();
    await expect(window.getByText(/PowerPoint: not available yet/)).toBeVisible();
    await capture('settings');
  } finally {
    await running.close();
  }
});
