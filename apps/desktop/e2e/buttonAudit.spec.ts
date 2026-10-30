import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import {
  launchApplication,
  openSettingsPage,
  showChat,
  type RunningApplication,
} from './application';
import { openKomaActions } from './komaControls';

let running: RunningApplication;
test.beforeEach(async () => {
  running = await launchApplication({ env: { KOMA_MOCK_DELAY_MS: '100' } });
  await running.window.getByRole('button', { name: 'Create a project' }).click();
});
test.afterEach(async () => {
  await running.close();
});

async function capture(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), scale: 'css' });
  await writeFile(
    test.info().outputPath(`${name}-buttons.json`),
    JSON.stringify(
      await page.locator('button, summary').evaluateAll((buttons) =>
        buttons.map((button) => ({
          text: button.textContent?.trim(),
          label: button.getAttribute('aria-label'),
          title: button.getAttribute('title'),
          role: button.getAttribute('role'),
          disabled: button.hasAttribute('disabled'),
          visible: button.getClientRects().length > 0,
        })),
      ),
      null,
      2,
    ),
  );
}

async function demo(): Promise<void> {
  const { window } = running;
  await window.getByRole('button', { name: 'Use the example request' }).click();
  await window.getByRole('button', { name: 'Generate Komas', exact: true }).click();
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
}

test('the compact Koma footer keeps the full menu, keyboard dismissal and destructive confirmation', async () => {
  const { window, application } = running;
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 700),
  );
  await capture(window, '01-empty-editor');
  await demo();
  const trigger = window.getByRole('button', { name: 'Koma actions', exact: true });
  await trigger.focus();
  await trigger.press('Enter');
  const menu = window.getByRole('menu', { name: 'Koma actions', exact: true });
  for (const action of [
    'New Koma after',
    'Duplicate Koma',
    'Move Koma up',
    'Move Koma down',
    'Delete Koma',
  ]) {
    await expect(menu.getByRole('menuitem', { name: action, exact: true })).toBeVisible();
  }
  await expect(menu.getByRole('menuitem', { name: 'Move Koma up', exact: true })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: 'Move Koma down', exact: true })).toBeEnabled();
  await capture(window, '02-koma-menu');
  await menu.getByRole('menuitem').first().press('End');
  await expect(menu.getByRole('menuitem', { name: 'Delete Koma', exact: true })).toBeFocused();
  await window.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  const reopened = await openKomaActions(window);
  await reopened.getByRole('menuitem', { name: 'Delete Koma', exact: true }).click();
  const confirmation = window.getByRole('dialog', { name: 'Delete Koma 1?', exact: true });
  await expect(confirmation).toContainText('You can undo this.');
  await confirmation.getByRole('button', { name: 'Keep Koma', exact: true }).click();
  await expect(
    window.getByRole('button', { name: 'Koma 1: One connected system', exact: true }),
  ).toBeVisible();
  await expect(trigger).toBeFocused();
  expect(running.problems).toEqual([]);
});

test('returning from Brand Kit restores Inspect focus and concise template actions still fill and save drafts', async () => {
  const { window, application } = running;
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 800),
  );
  await window.getByRole('button', { name: 'Brand Kit', exact: true }).click();
  const back = window.getByRole('button', { name: 'Back to Inspector', exact: true });
  await expect(back).toHaveAttribute('title', 'Back to Inspector');
  await back.focus();
  await back.press('Enter');
  await expect(window.getByRole('tab', { name: 'Inspect', exact: true })).toBeFocused();
  await expect(window.getByRole('complementary', { name: 'Inspector', exact: true })).toBeVisible();
  await showChat(window);
  await expect(
    window.getByRole('button', { name: 'Refresh providers', exact: true }),
  ).toBeVisible();
  await openSettingsPage(window, 'Instructions');
  await window.getByLabel('Project system instructions').fill('Use plain language.');
  await openSettingsPage(window, 'Templates');
  const settings = window.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(
    settings.getByRole('button', { name: 'Refresh templates', exact: true }),
  ).toHaveAttribute('title', 'Refresh templates');
  await settings.getByRole('button', { name: 'Use project instructions', exact: true }).click();
  await expect(settings.getByLabel('New template instructions')).toHaveValue('Use plain language.');
  await settings.getByLabel('New template name').fill('Plain');
  await settings.getByRole('button', { name: 'Save new template', exact: true }).click();
  await expect(
    settings.getByRole('status').filter({ hasText: 'Template library saved' }),
  ).toBeVisible();
  await settings.getByLabel('Saved instruction template').selectOption({ label: 'Plain' });
  for (const action of ['Rename', 'Duplicate', 'Delete']) {
    await expect(
      settings.getByRole('button', { name: `${action} template`, exact: true }),
    ).toHaveText(action);
  }
  await capture(window, '03-template-actions');
  await openSettingsPage(window, 'Providers');
  await expect(
    settings.getByRole('button', { name: 'Refresh providers', exact: true }),
  ).toBeVisible();
  await capture(window, '04-provider-actions');
  expect(running.problems).toEqual([]);
});
