import { expect, test } from '@playwright/test';
import { launchApplication, chooseProjectCommand, type RunningApplication } from './application';
import { mockModelDiscovery } from './modelFixtures';

let running: RunningApplication;
test.beforeEach(async () => {
  running = await launchApplication();
});
test.afterEach(async () => {
  await running.close();
});

test('provider checks explain stale results, failure and recovery without losing the project', async () => {
  const { window, application } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await chooseProjectCommand(window, 'Settings');
  const dialog = window.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('button', { name: 'Providers', exact: true }).click();
  await dialog.getByRole('button', { name: 'Refresh providers', exact: true }).click();
  await expect(dialog.getByText('Provider check complete.', { exact: true })).toBeVisible();
  await expect(
    dialog.getByText('Ready · version test-fixture', { exact: true }).first(),
  ).toBeVisible();
  await window.screenshot({ path: test.info().outputPath('providers-ready.png') });
  for (const size of [
    { width: 1480, height: 920 },
    { width: 1120, height: 720 },
  ]) {
    await application.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
    }, size);
    const guide = dialog.locator('.provider-connection');
    const diagram = guide.locator('svg');
    await expect(async () => {
      const bounds = await guide.boundingBox();
      const svg = await diagram.boundingBox();
      expect(bounds).not.toBeNull();
      expect(svg).not.toBeNull();
      if (bounds === null || svg === null) throw new Error('Connection guide is not visible');
      expect(Math.abs(svg.x + svg.width / 2 - (bounds.x + bounds.width / 2))).toBeLessThanOrEqual(
        1,
      );
      expect(svg.x).toBeGreaterThanOrEqual(bounds.x);
      expect(svg.x + svg.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    }).toPass();
    await expect(guide).toHaveCSS('text-align', 'center');
    await window.screenshot({
      path: test.info().outputPath(`providers-aligned-${String(size.width)}.png`),
    });
  }

  await application.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('koma:providers:detect');
    ipcMain.handle(
      'koma:providers:detect',
      () =>
        new Promise((_resolve, reject) => {
          ipcMain.once('test:finish-provider-check', () =>
            reject(new Error('Fixture connection failure')),
          );
        }),
    );
  });
  await dialog.getByRole('button', { name: 'Refresh providers', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Checking…', exact: true })).toBeDisabled();
  await expect(dialog.getByText('Checking installed providers…', { exact: true })).toBeVisible();
  await expect(
    dialog.getByText('Last check · Ready · version test-fixture', { exact: true }).first(),
  ).toBeVisible();
  const pulse = dialog.locator('.provider-check-pulse');
  await expect(pulse).toHaveCSS('animation-name', 'provider-check-travel');
  await window.emulateMedia({ reducedMotion: 'reduce' });
  await expect(pulse).toHaveCSS('animation-name', 'none');
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 720);
  });
  await window.screenshot({ path: test.info().outputPath('providers-checking-reduced.png') });

  await application.evaluate(({ ipcMain }) => {
    ipcMain.emit('test:finish-provider-check');
  });
  await expect(dialog.getByRole('alert')).toHaveText(
    'Provider check failed. Choose Refresh providers to retry.',
  );
  await expect(
    dialog.getByText('The results below are from the last completed check.'),
  ).toBeVisible();
  await window.screenshot({ path: test.info().outputPath('providers-failed.png') });
  await mockModelDiscovery(application);
  await dialog.getByRole('button', { name: 'Refresh providers', exact: true }).click();
  await expect(dialog.getByText('Provider check complete.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByText('Last check ·', { exact: false })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(window.getByRole('button', { name: 'Project menu', exact: true })).toBeVisible();
  await window.screenshot({ path: test.info().outputPath('quiet-stage-editor.png') });
  expect(running.problems).toEqual([]);
});

test('an empty provider response finishes checking and can recover without restoring the removed model editor', async () => {
  const { window, application } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await chooseProjectCommand(window, 'Settings');
  const dialog = window.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('button', { name: 'Providers', exact: true }).click();
  await application.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('koma:providers:detect');
    ipcMain.handle('koma:providers:detect', () => ({ providers: [] }));
  });
  await dialog.getByRole('button', { name: 'Refresh providers', exact: true }).click();
  await expect(
    dialog.getByText('Provider check complete. No providers found.', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Generation', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Choose model in chat', exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Providers', exact: true }).click();
  await mockModelDiscovery(application);
  await dialog.getByRole('button', { name: 'Refresh providers', exact: true }).click();
  await expect(dialog.getByText('Provider check complete.', { exact: true })).toBeVisible();
  await expect(
    dialog.getByText('Ready · version test-fixture', { exact: true }).first(),
  ).toBeVisible();
  expect(running.problems).toEqual([]);
});
