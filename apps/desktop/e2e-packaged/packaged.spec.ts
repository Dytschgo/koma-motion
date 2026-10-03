/**
 * Confirms from inside a packaged application that it is the version that is
 * about to be published, that it is isolated, and that its main workflow works.
 *
 *   KOMA_APP_EXECUTABLE   the executable of the packaged application
 *   KOMA_EXPECT_VERSION   the version it must report
 */
import { readFile } from 'node:fs/promises';
import { komaProjectSchema } from '@koma-motion/core';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  answerOpenDialog,
  answerSaveDialog,
  launchApplication,
  openSettingsPage,
  showInspector,
  type RunningApplication,
} from '../e2e/application';
import { selectProvider } from '../e2e/composerControls';

const executablePath = process.env['KOMA_APP_EXECUTABLE'] ?? '';
const expectedVersion = process.env['KOMA_EXPECT_VERSION'] ?? '';

test.beforeAll(() => {
  expect(executablePath, 'KOMA_APP_EXECUTABLE must name the packaged application').not.toBe('');
  expect(expectedVersion, 'KOMA_EXPECT_VERSION must name the expected version').not.toBe('');
});

let running: RunningApplication;

test.beforeEach(async () => {
  running = await launchApplication({ executablePath });
});

test.afterEach(async () => {
  await running.close();
});

test('is the packaged application of the expected version', async () => {
  const { application, window } = running;
  const facts = await application.evaluate(({ app }) => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    name: app.getName(),
  }));
  expect(facts).toEqual({ version: expectedVersion, packaged: true, name: 'Koma Motion' });

  await expect(window.getByRole('heading', { name: /Presentations are frames/ })).toBeVisible();
  await openSettingsPage(window, 'Updates');
  const updates = window.getByRole('region', { name: 'App updates' });
  await expect(updates.getByText(`Installed version: ${expectedVersion}`)).toBeVisible();
  await expect(updates.getByLabel('Update channel')).toHaveValue('stable');

  // Nightly builds say what they are.
  const badge = window.getByText('Nightly', { exact: true });
  await expect(badge).toHaveCount(expectedVersion.includes('-nightly.') ? 1 : 0);
});

test('disables update checks in the packaged smoke environment', async () => {
  const { window } = running;
  await openSettingsPage(window, 'Updates');
  await window.getByRole('button', { name: 'Check for updates' }).click();
  await expect(
    window.getByText('Updates are available in installed versions of Koma Motion.'),
  ).toBeVisible();
});

test('isolates the window', async () => {
  const exposed = await running.window.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>)['require'],
    process: typeof (globalThis as Record<string, unknown>)['process'],
    bridge: Object.keys((globalThis as Record<string, unknown>)['komaMotion'] ?? {}).sort(),
  }));
  expect(exposed).toEqual({
    require: 'undefined',
    process: 'undefined',
    bridge: ['invoke', 'subscribe'],
  });
});

test('creates, generates, previews, edits, saves and reopens a presentation', async () => {
  const { window, application, directory, problems } = running;
  const filePath = join(directory, 'packaged.koma');

  await window.getByRole('button', { name: 'Create a project' }).click();
  await window.getByLabel('Project name').fill('Packaged');
  await selectProvider(window, 'mock');
  await window.getByRole('button', { name: 'Use the example request' }).click();
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  await expect(
    window.getByRole('list', { name: 'Komas' }).getByRole('button', { name: /^Koma \d:/ }),
  ).toHaveCount(3);

  // The fonts and the styles of the interface are part of the package.
  const fontFamily = await window.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(fontFamily).toContain('Instrument Sans');
  await expect
    .poll(() => window.evaluate(() => document.fonts.check('16px "Instrument Sans Variable"')))
    .toBe(true);

  await window.getByRole('button', { name: 'Preview', exact: true }).click();
  const stage = window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');
  await expect(stage).toHaveAttribute('aria-label', 'Koma 2: The motion engine', {
    timeout: 15_000,
  });
  await showInspector(window);
  await stage.getByRole('button', { name: 'Motion engine (shape)', exact: true }).click();
  await window.getByLabel('Width', { exact: true }).fill('460');
  await window.getByLabel('Width', { exact: true }).press('Tab');
  await expect(window.getByLabel('Width', { exact: true })).toHaveValue('460');

  await answerSaveDialog(application, filePath);
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('All changes saved')).toBeVisible();
  const saved = komaProjectSchema.parse(JSON.parse(await readFile(filePath, 'utf8')));
  expect(saved).toMatchObject({
    format: 'koma-motion-project',
    name: 'Packaged',
    generationHistory: [{ providerId: 'mock', status: 'succeeded' }],
  });
  expect(
    saved.presentation.komas[1]?.elements.find(
      (element) => element.persistentId === 'motion-engine',
    )?.size.width,
  ).toBe(460);
  await answerOpenDialog(application, filePath);
  await window.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(window.getByLabel('Project name')).toHaveValue('Packaged');
  await window.getByRole('button', { name: 'Koma 2: The motion engine', exact: true }).click();
  await stage.getByRole('button', { name: 'Motion engine (shape)', exact: true }).click();
  await expect(window.getByLabel('Width', { exact: true })).toHaveValue('460');
  // The generation record and all generated Komas remain in the same real project file.
  await expect(
    window.getByRole('list', { name: 'Komas' }).getByRole('button', { name: /^Koma \d:/ }),
  ).toHaveCount(3);
  await window.screenshot({ path: test.info().outputPath('packaged-edited-reopened.png') });
  expect(problems).toEqual([]);
});
