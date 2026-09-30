import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { answerSaveDialog, launchApplication } from './application';

test('opens secondary guidance by hover, keyboard and click without clipping', async () => {
  const running = await launchApplication();
  const { window, application } = running;
  try {
    await window.getByRole('button', { name: 'Create a project' }).click();
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 700);
    });
    const help = window.getByRole('button', { name: 'Generation settings', exact: true });
    const tooltip = window.getByRole('tooltip');
    await expect(tooltip).toHaveCount(0);
    await help.hover();
    await expect(tooltip).toContainText('No time limit');
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
    await window.getByRole('button', { name: 'Canvas shortcuts', exact: true }).click();
    await expect(tooltip).toContainText('Enter edits text');
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});

test('closes chat help when Brand Kit hides its trigger', async () => {
  const running = await launchApplication();
  const { window, application } = running;
  try {
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 700);
    });
    await window.getByRole('button', { name: 'Create a project' }).click();
    const help = window.getByRole('button', { name: 'About the chat' });
    const tooltip = window.getByRole('tooltip');
    await help.focus();
    await help.press('Enter');
    await expect(tooltip).toContainText('Hide the chat');

    const brandKit = window.getByRole('button', { name: 'Brand Kit', exact: true });
    await brandKit.focus();
    await brandKit.press('Enter');
    await expect(window.getByRole('button', { name: 'Show the chat' })).toBeVisible();
    await expect(tooltip).toHaveCount(0);
    await answerSaveDialog(application, join(running.directory, 'hidden-help.koma'));
    await window.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(window.getByText('All changes saved')).toBeVisible();

    await window.getByRole('button', { name: 'Show the chat' }).click();
    await expect(help).toBeVisible();
    await expect(tooltip).toHaveCount(0);
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});
