import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { answerOpenDialog, launchApplication } from './application';

test('live Claude Code Opus analyzes only the prepared synthetic deck', async ({
  browserName: _browserName,
}, testInfo) => {
  test.skip(
    process.env['KOMA_LIVE_DECK_ANALYSIS'] !== '1',
    'Explicit opt-in required: this sends synthetic slide text and images to Anthropic.',
  );
  test.setTimeout(240000);
  const running = await launchApplication();
  try {
    const { window, application } = running;
    await window.getByRole('button', { name: 'Create a project' }).click();
    await window.getByRole('button', { name: 'Brand Kit', exact: true }).click();
    await window.getByRole('tab', { name: /Library/ }).click();
    await window.getByRole('button', { name: 'Create Brand Kit from deck' }).click();
    await answerOpenDialog(application, resolve('e2e/fixtures/decks/northstar.pdf'));
    await window.getByRole('button', { name: 'Choose PPTX or PDF' }).click();
    const dialog = window.getByRole('dialog', { name: 'Create Brand Kit from deck' });
    await expect(dialog.getByText('Prepared slides: 1, 2, 3 of 3.')).toBeVisible();
    await expect(
      dialog.getByText(/sent to Anthropic through your existing Claude Code/),
    ).toBeVisible();
    await window.screenshot({ path: testInfo.outputPath('live-01-disclosure.png') });
    await dialog.getByRole('button', { name: 'Send selected content and analyze' }).click();
    await expect(dialog.getByRole('status')).toContainText('Opus');
    await window.screenshot({ path: testInfo.outputPath('live-02-progress.png') });
    const review = window.getByRole('dialog', { name: 'Review Brand Kit proposal' });
    await expect(review).toBeVisible({ timeout: 190000 });
    await expect(review.getByLabel('Brand name', { exact: true })).toHaveValue(/Northstar/i);
    await expect(review.getByLabel('Background colour', { exact: true })).toHaveValue(
      /^#[0-9A-F]{6}$/i,
    );
    await window.screenshot({ path: testInfo.outputPath('live-03-review.png') });
    await writeFile(testInfo.outputPath('live-review.txt'), await review.innerText());
    await review.getByLabel('Library name', { exact: true }).fill('Northstar · Opus verified');
    await review.getByRole('button', { name: 'Save new Brand Kit' }).click();
    await expect(
      window.getByRole('button', { name: 'Northstar · Opus verified', exact: true }),
    ).toBeVisible();
    await window.screenshot({ path: testInfo.outputPath('live-04-saved.png') });
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});
