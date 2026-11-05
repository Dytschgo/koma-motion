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
