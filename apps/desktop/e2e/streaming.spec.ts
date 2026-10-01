import { expect, test } from '@playwright/test';
import { launchApplication, showChat, type RunningApplication } from './application';

let running: RunningApplication;
test.beforeEach(async () => {
  // Keep each streamed phase visible long enough to observe on slower CI runners.
  running = await launchApplication({ env: { KOMA_MOCK_DELAY_MS: '6000' } });
});
test.afterEach(async () => {
  await running.close();
});

test('streams what the provider writes into the chat and keeps it with the result', async () => {
  const { window, problems } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await showChat(window);
  await window.getByRole('button', { name: 'Use the example request' }).click();
  await window.getByRole('button', { name: 'Generate Komas' }).click();

  // While it runs, the text appears in its own region, not in the status.
  const output = window.getByRole('region', { name: 'Output from Mock provider' });
  await expect(output).toContainText('Demo narration from the mock provider.');
  await expect(output).toContainText('Then it picks a staged transition');
  await expect(window.getByRole('status').filter({ hasText: 'Demo narration' })).toHaveCount(0);

  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
  await expect(output).toHaveCount(0);
  const kept = window.getByText('What Mock provider wrote');
  await kept.click();
  await expect(
    window.getByRole('log', { name: 'Conversation' }).getByText(/It outlines three Komas/),
  ).toBeVisible();
  await expect(
    window
      .getByRole('log', { name: 'Conversation' })
      .getByText(/Then it picks a staged transition/),
  ).toBeVisible();
  expect(problems).toEqual([]);
});

test('does not pull the conversation down while the person reads earlier text', async () => {
  const { window, application, problems } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1480, 700);
  });
  await window.getByRole('button', { name: 'Create a project' }).click();
  await showChat(window);
  const log = window.getByRole('log', { name: 'Conversation' });
  for (let index = 0; index < 3; index += 1) {
    await window
      .getByLabel('Your request')
      .fill(`Request ${String(index + 1)}: show three stages.`);
    await window.getByRole('button', { name: 'Generate Komas' }).click();
    await expect(window.getByText(/Created 3 Komas/)).toHaveCount(index + 1);
  }
  expect(await log.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);

  await window.getByLabel('Your request').fill('Request 4: show three stages.');
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  const output = window.getByRole('region', { name: 'Output from Mock provider' });
  await expect(output).toContainText('Demo narration');
  await log.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll'));
  });
  await expect(output).toContainText('Then it picks a staged transition');
  expect(await log.evaluate((node) => node.scrollTop)).toBeLessThan(10);

  // A new entry scrolls to the end again.
  await expect(window.getByText(/Created 3 Komas/)).toHaveCount(4);
  await expect
    .poll(() => log.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight))
    .toBeLessThan(48);
  expect(problems).toEqual([]);
});
