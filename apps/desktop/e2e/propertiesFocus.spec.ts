import { expect, test } from '@playwright/test';
import { launchApplication } from './application';

test('returns keyboard focus to Properties after pinning, unpinning and closing', async () => {
  const running = await launchApplication();
  try {
    const { window } = running;
    await window.getByRole('button', { name: 'Create a project' }).click();
    const trigger = window.getByRole('button', { name: 'Properties', exact: true });
    await trigger.focus();
    await window.keyboard.press('Enter');
    const panel = window.getByRole('region', { name: 'Properties', exact: true });
    await expect(panel).toBeFocused();
    await panel.getByRole('button', { name: 'Pin properties', exact: true }).focus();
    await window.keyboard.press('Enter');
    await panel.getByRole('button', { name: 'Unpin properties', exact: true }).focus();
    await window.keyboard.press('Enter');
    await expect(panel).toBeFocused();
    await window.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});
