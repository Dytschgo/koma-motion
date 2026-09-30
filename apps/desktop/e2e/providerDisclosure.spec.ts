import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildProject } from '@koma-motion/core/testing';
import { expect, test } from '@playwright/test';
import { answerOpenDialog, launchApplication } from './application';

test('explains existing content sent by external providers before generation', async () => {
  const running = await launchApplication();
  const { window, application, directory } = running;
  try {
    const filePath = join(directory, 'existing-content.koma');
    await writeFile(filePath, JSON.stringify(buildProject()));
    await answerOpenDialog(application, filePath);
    await window.getByRole('button', { name: 'Open a project' }).click();
    await expect(window.getByLabel('Project name')).toHaveValue('Fixture project');
    const provider = window.getByLabel('Provider');
    await provider.selectOption('claude-code');
    const disclosure = window.getByText(
      'Claude Code sends your request, Brand Kit, a text summary of existing Komas, and asset names to an online service.',
      { exact: true },
    );
    await expect(disclosure).toBeVisible();
    await window.screenshot({ path: test.info().outputPath('provider-disclosure.png') });
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1120, 700);
    });
    await expect(disclosure).toBeVisible();
    // The chat body scrolls in a low window; the disclosure must be reachable there.
    await disclosure.scrollIntoViewIfNeeded();
    const box = await disclosure.boundingBox();
    const viewport = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    if (box === null) throw new Error('Provider disclosure has no visible bounds.');
    // One pixel for rounding at a fractional device scale factor.
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    await window.screenshot({ path: test.info().outputPath('provider-disclosure-narrow.png') });
    await provider.selectOption('mock');
    await expect(disclosure).toHaveCount(0);
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});
