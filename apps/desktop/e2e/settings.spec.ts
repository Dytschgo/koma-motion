import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { answerSaveDialog, launchApplication, type RunningApplication } from './application';

let running: RunningApplication;
test.beforeEach(async () => {
  running = await launchApplication();
});
test.afterEach(async () => {
  await running.close();
});

function settings(window: Page) {
  return window.getByRole('dialog', { name: 'Settings', exact: true });
}

function category(window: Page, name: string) {
  return settings(window)
    .getByRole('navigation', { name: 'Settings categories' })
    .getByRole('button', { name, exact: true });
}

test('groups categories by where they are stored and moves with the keyboard', async () => {
  const { window } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  const opener = window.getByRole('button', { name: 'Settings', exact: true });
  await opener.click();
  const dialog = settings(window);
  await expect(dialog).toBeVisible();

  const navigation = dialog.getByRole('navigation', { name: 'Settings categories' });
  await expect(navigation).toContainText('This project');
  await expect(navigation).toContainText('Koma Motion');
  await expect(category(window, 'Instructions')).toHaveAttribute('aria-current', 'page');
  await expect(dialog.getByRole('heading', { name: 'Instructions', level: 3 })).toBeVisible();
  await expect(
    dialog.getByText('Saved in the .koma file of this project. Undo applies.'),
  ).toBeVisible();

  await category(window, 'Instructions').focus();
  await window.keyboard.press('ArrowDown');
  await expect(category(window, 'Generation')).toBeFocused();
  await expect(category(window, 'Generation')).toHaveAttribute('aria-current', 'page');
  await expect(dialog.getByRole('heading', { name: 'Generation', level: 3 })).toBeVisible();
  await window.keyboard.press('End');
  await expect(category(window, 'About')).toBeFocused();
  await window.keyboard.press('ArrowDown');
  await expect(category(window, 'Instructions')).toBeFocused();
  await window.keyboard.press('ArrowUp');
  await expect(category(window, 'About')).toBeFocused();

  await category(window, 'Updates').click();
  await expect(
    dialog.getByText('Saved in Koma Motion on this computer. Applies to every project.'),
  ).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'App updates' })).toBeVisible();
  await category(window, 'Providers').click();
  await expect(dialog.getByText('Checked on this computer. Nothing is saved.')).toBeVisible();
  await expect(dialog.getByText('Mock provider', { exact: false }).first()).toBeVisible();

  // Escape closes Settings and returns focus to the control that opened it.
  await window.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  // Settings reopens on the page it showed last.
  await opener.click();
  await expect(category(window, 'Providers')).toHaveAttribute('aria-current', 'page');
  await dialog.getByRole('button', { name: 'Close settings' }).click();
  await expect(dialog).toBeHidden();
  expect(running.problems).toEqual([]);
});

test('project settings are saved in the project and can be undone', async () => {
  const { window, application, directory } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await window.getByRole('button', { name: 'Settings', exact: true }).click();
  await category(window, 'Generation').click();
  const limit = settings(window).getByRole('switch', {
    name: 'Stop generation after a time limit',
  });
  await expect(limit).not.toBeChecked();
  await limit.check();
  await settings(window).getByLabel('Time limit in seconds', { exact: true }).fill('45');
  await settings(window).getByRole('button', { name: 'Done' }).click();
  await expect(window.getByText('Stops after 45 seconds.', { exact: false })).toBeVisible();

  const path = join(directory, 'limits.koma');
  await answerSaveDialog(application, path);
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('All changes saved')).toBeVisible();
  const saved: unknown = JSON.parse(await readFile(path, 'utf8'));
  expect(saved).toHaveProperty('agentConfiguration.timeoutSeconds', 45);

  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(window.getByText('Stops after', { exact: false })).toHaveCount(0);
  await window.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(limit).not.toBeChecked();
  expect(running.problems).toEqual([]);
});

test('project pages explain that a project is needed, and the layout fits the smallest window', async () => {
  const { window, application } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 700);
  });
  await window.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = settings(window);
  await expect(dialog.getByText('No project open', { exact: true })).toBeVisible();
  await expect(dialog.getByText('No project is open').filter({ visible: true })).toBeVisible();
  await category(window, 'Generation').click();
  await expect(dialog.getByText('No project is open').filter({ visible: true })).toBeVisible();

  const box = await dialog.boundingBox();
  const viewport = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  if (box === null) throw new Error('Missing dialog bounds');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await expect(dialog.getByRole('button', { name: 'Done' })).toBeInViewport({ ratio: 1 });
  await category(window, 'Templates').click();
  await window.screenshot({ path: test.info().outputPath('settings-templates-1120.png') });
  expect(running.problems).toEqual([]);
});
