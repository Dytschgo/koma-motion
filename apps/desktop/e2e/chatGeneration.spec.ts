import { expect, test } from '@playwright/test';
import { launchApplication, showChat, type RunningApplication } from './application';

let running: RunningApplication;

test.beforeEach(async () => {
  running = await launchApplication({ env: { KOMA_MOCK_DELAY_MS: '2400' } });
  await running.window.getByRole('button', { name: 'Create a project' }).click();
  await showChat(running.window);
});

test.afterEach(async () => {
  if (test.info().status !== test.info().expectedStatus) {
    await running.window.screenshot({ path: test.info().outputPath('chat.png'), scale: 'css' });
  }
  await running.close();
});

test('returns focus to the request after sending with the pointer so the next idea can be drafted', async () => {
  const { window, problems } = running;
  const request = window.getByLabel('Your request');
  await request.fill('Show three stages of an idea.');
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  await expect(window.getByRole('button', { name: 'Stop generating' })).toBeVisible();
  await expect(request).toBeFocused({ timeout: 1000 });
  await window.keyboard.type('The next idea stays in the draft.');
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
  await expect(request).toHaveValue('The next idea stays in the draft.');
  await expect(request).toBeFocused();
  expect(problems).toEqual([]);
});

test('retrying a stopped request preserves a different follow-up draft and blocks duplicate retries', async () => {
  const { window, problems } = running;
  const request = window.getByLabel('Your request');
  const log = window.getByRole('log', { name: 'Conversation' });
  await request.fill('The original request to retry.');
  await request.press('Enter');
  await window.getByRole('button', { name: 'Stop generating' }).click();
  await expect(log.getByText('Generation stopped')).toBeVisible();
  await expect(request).toBeFocused();
  await request.fill('A separate follow-up I have not sent.');
  const retry = log.getByRole('button', { name: 'Recheck', exact: true });
  await retry.click();
  await expect(log.getByText(/You asked:/)).toHaveCount(2);
  await expect(request).toHaveValue('A separate follow-up I have not sent.');
  await expect(request).toBeFocused();
  await expect(retry).toBeDisabled();
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
  await expect(request).toHaveValue('A separate follow-up I have not sent.');
  expect(problems).toEqual([]);
});

test('keeps the composer and header stationary around a scrollable conversation in a short window', async () => {
  const { window, application, problems } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1024, 655);
  });
  const chat = window.getByRole('region', { name: 'Agent chat' });
  const divider = window.getByRole('separator', { name: 'Resize studio dock' });
  await divider.focus();
  await window.keyboard.press('Home');
  const request = window.getByLabel('Your request');
  await request.fill('Create the starting Komas.');
  await request.press('Enter');
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
  await request.fill('An extended request with room for a detailed story. '.repeat(30));
  await request.press('Enter');
  await window.getByRole('button', { name: 'Stop generating' }).click();
  await expect(window.getByText('Generation stopped')).toBeVisible();
  await request.fill('A long follow-up with more details to keep. '.repeat(80));
  const log = chat.getByRole('log', { name: 'Conversation' });
  await expect
    .poll(() =>
      log.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight),
    )
    .toBeLessThan(48);
  await divider.focus();
  await window.keyboard.press('Shift+ArrowLeft');
  await expect
    .poll(() =>
      log.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight),
    )
    .toBeLessThan(48);
  await expect(request).toBeInViewport({ ratio: 1 });
  await expect(window.getByTestId('chat-header')).toBeInViewport({ ratio: 1 });
  await expect(window.getByRole('button', { name: 'Generate Komas' })).toBeInViewport({ ratio: 1 });
  await expect
    .poll(() => chat.evaluate((body) => body.scrollHeight - body.clientHeight))
    .toBeLessThanOrEqual(1);
  expect(await log.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await log.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(chat.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
  await request.fill('Shorter draft while I keep reading history.');
  expect(await log.evaluate((element) => element.scrollTop)).toBeLessThan(10);
  await expect(chat.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 800);
  });
  expect(await log.evaluate((element) => element.scrollTop)).toBeLessThan(10);
  await expect(window.getByTestId('chat-header')).toBeInViewport({ ratio: 1 });
  // Reading history is still reading history after visiting another dock context.
  for (const target of [0, 120]) {
    await log.evaluate((element, top) => {
      element.scrollTop = top;
      element.dispatchEvent(new Event('scroll'));
    }, target);
    const readingPosition = await log.evaluate((element) => element.scrollTop);
    await expect(chat.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
    await window.getByRole('tab', { name: 'Inspect', exact: true }).click();
    await window.getByRole('tab', { name: 'Chat', exact: true }).click();
    await expect.poll(() => log.evaluate((element) => element.scrollTop)).toBe(readingPosition);
    await expect(chat.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
    await expect(request).toHaveValue('Shorter draft while I keep reading history.');
  }
  await chat.getByRole('button', { name: 'Jump to latest' }).click();
  await expect
    .poll(() =>
      log.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight),
    )
    .toBeLessThan(48);
  await window.screenshot({ path: test.info().outputPath('short-studio.png'), scale: 'css' });
  expect(problems).toEqual([]);
});
