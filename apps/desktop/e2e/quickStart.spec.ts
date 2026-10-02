import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type Page } from '@playwright/test';
import {
  APPLICATION_DIRECTORY,
  answerSaveDialog,
  getApplicationEnvironment,
  launchApplication,
  type RunningApplication,
} from './application';

let running: RunningApplication;
test.beforeEach(async () => {
  running = await launchApplication();
});
test.afterEach(async () => {
  await running.close();
});

const guide = (window: Page) =>
  window.getByRole('dialog', { name: 'Getting started', exact: true });
const reopen = async (window: Page) => {
  await window.getByRole('button', { name: 'Getting started', exact: true }).click();
  await expect(guide(window)).toBeVisible();
};
const step = async (window: Page, name: string) => {
  await guide(window).getByRole('navigation').getByRole('button', { name, exact: true }).click();
  await expect(guide(window).getByRole('heading', { name, exact: true })).toBeFocused();
};

test('opens on demand, supports keyboard navigation, dismisses and reopens at narrow sizes', async () => {
  const { window, application } = running;
  await expect(guide(window)).toBeHidden();
  const welcomeLink = window.getByRole('button', { name: 'Open quick-start guide' });
  await welcomeLink.focus();
  await window.keyboard.press('Enter');
  await expect(guide(window).getByRole('heading', { name: '1. Start', exact: true })).toBeFocused();
  await expect(
    guide(window).getByText(/Solar system, Quarterly results and Rapunzel story/),
  ).toBeVisible();
  await guide(window).getByRole('button', { name: 'Next', exact: true }).focus();
  await window.keyboard.press('Enter');
  await expect(
    guide(window).getByRole('heading', { name: '2. Brand Kit', exact: true }),
  ).toBeFocused();
  await expect(
    guide(window).getByRole('button', { name: 'Open Brand Kit library' }),
  ).toBeDisabled();
  await expect(guide(window).getByText(/Create or open a project/)).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(guide(window)).toBeHidden();
  await expect(welcomeLink).toBeFocused();
  await window.mouse.move(0, 0);
  await window.screenshot({ scale: 'css', path: test.info().outputPath('welcome-guide.png') });
  await reopen(window);
  await expect(
    guide(window).getByRole('heading', { name: '2. Brand Kit', exact: true }),
  ).toBeFocused();
  await window.emulateMedia({ reducedMotion: 'reduce' });
  await application.evaluate(({ BrowserWindow }) => {
    const native = BrowserWindow.getAllWindows()[0];
    native?.setMinimumSize(480, 480);
    native?.setContentSize(600, 640);
  });
  for (const name of [
    '1. Start',
    '2. Brand Kit',
    '3. Instructions',
    '4. Generate',
    '5. Edit & repair',
    '6. Play',
    '7. Export',
  ]) {
    await step(window, name);
    await expect(
      guide(window).getByRole('button', { name: 'Close getting started' }),
    ).toBeInViewport({ ratio: 1 });
    await expect(guide(window).getByRole('checkbox')).toBeInViewport({ ratio: 1 });
    expect(
      await guide(window).evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
  }
  await window.screenshot({
    scale: 'css',
    path: test.info().outputPath('guide-narrow-export.png'),
  });
  await guide(window).getByRole('button', { name: 'Back', exact: true }).click();
  await expect(guide(window).getByRole('heading', { name: '6. Play', exact: true })).toBeFocused();
  await guide(window).getByRole('button', { name: 'Next', exact: true }).click();
  await guide(window).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(guide(window)).toBeHidden();
  await reopen(window);
  await expect(
    guide(window).getByRole('heading', { name: '7. Export', exact: true }),
  ).toBeFocused();
  await step(window, '2. Brand Kit');
  // Tab and Shift+Tab remain in the native modal even after scrolling the content.
  await guide(window).getByRole('button', { name: 'Close getting started' }).focus();
  await window.keyboard.press('Shift+Tab');
  expect(await guide(window).evaluate((element) => element.contains(document.activeElement))).toBe(
    true,
  );
  await window.screenshot({
    scale: 'css',
    path: test.info().outputPath('guide-narrow-brand-kit.png'),
  });
  await test.info().attach('native-window', {
    body: JSON.stringify(
      await window.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      })),
    ),
    contentType: 'application/json',
  });
  await guide(window).getByRole('button', { name: 'Close getting started' }).click();
  await expect(window.getByRole('button', { name: 'Getting started', exact: true })).toBeFocused();
  expect(running.problems).toEqual([]);
});

test('links to real workflows without changing the project and preserves completion across restart', async () => {
  const { window, application, directory } = running;
  await reopen(window);
  await guide(window).getByRole('button', { name: 'Create a project', exact: true }).click();
  await expect(window.getByLabel('Project name')).toBeVisible();
  await reopen(window);
  await step(window, '2. Brand Kit');
  await guide(window).getByRole('button', { name: 'Edit project Brand Kit' }).click();
  await expect(window.getByLabel('Brand name', { exact: true })).toBeVisible();
  await expect(window.getByRole('tab', { name: 'This project' })).toBeFocused();
  await reopen(window);
  await guide(window).getByRole('button', { name: 'Open Brand Kit library' }).click();
  await expect(window.getByRole('button', { name: 'Create Brand Kit from deck' })).toBeVisible();
  await expect(window.getByRole('tab', { name: /^Library/ })).toBeFocused();
  await reopen(window);
  await step(window, '3. Instructions');
  await guide(window).getByRole('button', { name: 'Open project instructions' }).click();
  await expect(window.getByLabel('Project system instructions')).toBeVisible();
  await window.keyboard.press('Escape');
  await reopen(window);
  await guide(window).getByRole('button', { name: 'Open instruction templates' }).click();
  await expect(window.getByRole('heading', { name: 'Saved templates', exact: true })).toBeVisible();
  await window.keyboard.press('Escape');
  await reopen(window);
  await step(window, '4. Generate');
  await guide(window).getByRole('button', { name: 'Check providers' }).click();
  await expect(window.getByRole('heading', { name: 'Available providers' })).toBeVisible();
  await window.keyboard.press('Escape');
  await reopen(window);
  await guide(window).getByRole('button', { name: 'Model settings' }).click();
  await expect(window.getByRole('heading', { name: 'Models', exact: true })).toBeVisible();
  await window.keyboard.press('Escape');
  await reopen(window);
  await guide(window).getByRole('button', { name: 'Open chat' }).click();
  await expect(window.getByLabel('Your request')).toBeFocused();
  await window.getByLabel('Your request').fill('Show the local demo');
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();

  await reopen(window);
  await step(window, '5. Edit & repair');
  await guide(window).getByRole('button', { name: 'Open canvas & Inspector' }).click();
  await expect(window.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
  await expect(window.getByRole('region', { name: 'Canvas' })).toBeFocused();
  await reopen(window);
  await guide(window).getByRole('button', { name: 'Inspect motion' }).click();
  await expect(window.getByRole('tab', { name: 'Motion', exact: true })).toBeFocused();
  await reopen(window);
  await step(window, '6. Play');
  await expect(guide(window).getByText(/full-presentation player is not available/)).toBeVisible();
  await guide(window).getByRole('button', { name: 'Go to preview controls' }).click();
  await expect(window.getByRole('group', { name: 'Transition preview' })).toBeFocused();
  await window.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(
    window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]'),
  ).toHaveAttribute('aria-label', 'Koma 2: The motion engine');
  await reopen(window);
  await step(window, '7. Export');
  await guide(window).getByRole('button', { name: 'Go to Export' }).click();
  await expect(window.getByRole('button', { name: 'Export', exact: true })).toBeFocused();
  await window.keyboard.press('Enter');
  await expect(window.getByRole('dialog', { name: 'Export PowerPoint' })).toBeVisible();
  await expect(window.getByRole('button', { name: 'Choose destination' })).toBeEnabled();
  await window.keyboard.press('Escape');

  const filePath = join(directory, 'guide-test.koma');
  await answerSaveDialog(application, filePath);
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('All changes saved')).toBeVisible();
  const saved = await readFile(filePath, 'utf8');
  await reopen(window);
  await step(window, '2. Brand Kit');
  await window.mouse.move(0, 0);
  await window.screenshot({ scale: 'css', path: test.info().outputPath('guide-brand-kit.png') });
  await guide(window).getByRole('checkbox').check();
  await expect(guide(window).getByText('Completed', { exact: true })).toBeVisible();
  await expect(window.getByText('All changes saved')).toBeVisible();
  await guide(window).getByRole('button', { name: 'Close getting started' }).click();
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  expect(await readFile(filePath, 'utf8')).toBe(saved);
  expect(running.problems).toEqual([]);

  // A new native process, using this test's isolated profile, proves app-level persistence.
  await application.close();
  const restarted = await electron.launch({
    args: [
      APPLICATION_DIRECTORY,
      `--user-data-dir=${join(directory, 'user-data')}`,
      '--force-device-scale-factor=0.5',
    ],
    cwd: APPLICATION_DIRECTORY,
    env: getApplicationEnvironment(),
  });
  try {
    const fresh = await restarted.firstWindow();
    await expect(fresh.getByRole('heading', { name: /Presentations are frames/ })).toBeVisible();
    await expect(guide(fresh)).toBeHidden();
    await reopen(fresh);
    await expect(guide(fresh).getByRole('checkbox')).toBeChecked();
    await guide(fresh).getByRole('checkbox').uncheck();
    await fresh.keyboard.press('Escape');
    await reopen(fresh);
    await expect(guide(fresh).getByRole('checkbox')).not.toBeChecked();
  } finally {
    await restarted.close();
  }
});
