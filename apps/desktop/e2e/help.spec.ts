import { expect, test } from '@playwright/test';
import { launchApplication } from './application';

test('opens secondary guidance by hover, keyboard and click without clipping', async () => {
  const running = await launchApplication();
  const { window, application } = running;
  try {
    await window.getByRole('button', { name: 'Create a project' }).click();
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 700);
    });
    const help = window.getByRole('button', { name: 'Canvas shortcuts', exact: true });
    const tooltip = window.getByRole('tooltip');
    await expect(tooltip).toHaveCount(0);
    await help.hover();
    await expect(tooltip).toContainText('Enter edits text');
    await tooltip.hover();
    await expect(tooltip).toBeVisible();
    const box = await tooltip.boundingBox();
    const viewport = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    if (!box) throw new Error('Missing help bounds');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await window.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await window.mouse.move(1, 1);
    await expect(tooltip).toHaveCount(0);
    await help.focus();
    await expect(tooltip).toBeVisible();
    await help.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await expect(help).toBeFocused();
    await help.press('Enter');
    await expect(tooltip).toBeVisible();
    await window.getByLabel('Your request').click();
    await expect(tooltip).toHaveCount(0);
    await help.click();
    await expect(tooltip).toContainText('Enter edits text');
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});

test('closes help when its trigger leaves the screen', async () => {
  const running = await launchApplication();
  const { window } = running;
  try {
    const help = window.getByRole('button', { name: 'About Koma Motion project files' });
    const tooltip = window.getByRole('tooltip');
    await help.focus();
    await help.press('Enter');
    await expect(tooltip).toBeVisible();

    // Creating a project replaces the welcome screen that holds the trigger.
    const create = window.getByRole('button', { name: 'Create a project' });
    await create.focus();
    await create.press('Enter');
    await expect(help).toHaveCount(0);
    await expect(tooltip).toHaveCount(0);
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});
