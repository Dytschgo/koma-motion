import { agentError } from '@koma-motion/agent-runtime';
import { expect, test } from '@playwright/test';
import { ipcContract } from '../src/shared/ipc';
import { launchApplication, showChat } from './application';

test('a failed stop can be retried from the run monitor without losing the draft', async () => {
  const running = await launchApplication();
  const { application, window } = running;
  try {
    const timestamp = '2026-10-31T12:00:00.000Z';
    const requestText = 'Create three Komas about motion.';
    const cancelled = ipcContract['koma:providers:execute'].response.parse({
      status: 'cancelled',
      error: agentError('cancelled', 'Generation stopped.'),
      historyEntry: {
        id: 'cancel-retry-fixture',
        createdAt: timestamp,
        providerId: 'mock',
        userRequest: requestText,
        status: 'cancelled',
        summary: 'Generation stopped.',
        warnings: [],
      },
      diagnostics: {
        providerId: 'mock',
        startedAt: timestamp,
        finishedAt: timestamp,
        durationMs: 0,
        promptTemplate: '',
        attempts: [],
      },
    });
    // Hold execution until a second cancellation reaches main. The first fails.
    const fixture = await application.evaluateHandle(({ ipcMain }, outcome) => {
      let finish: ((reply: unknown) => void) | undefined;
      let attempts = 0;
      ipcMain.removeHandler('koma:providers:execute');
      ipcMain.handle(
        'koma:providers:execute',
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      ipcMain.removeHandler('koma:providers:cancel');
      ipcMain.handle('koma:providers:cancel', () => {
        attempts += 1;
        if (attempts === 1) throw new Error('Fixture: stop IPC unavailable');
        if (finish === undefined) throw new Error('No active fixture run');
        finish(outcome);
        return { cancelled: true };
      });
      return { attempts: () => attempts };
    }, cancelled);

    await window.getByRole('button', { name: 'Create a project' }).click();
    await showChat(window);
    const request = window.getByLabel('Your request');
    await request.fill(requestText);
    await window.getByRole('button', { name: 'Generate Komas' }).click();
    await window.getByRole('button', { name: 'Open run monitor' }).click();
    const monitor = window.getByRole('dialog', { name: 'Run monitor' });
    await monitor.getByRole('button', { name: 'Cancel run' }).click();
    await expect(window.getByText('The generation could not be stopped. Try again.')).toBeVisible();
    await expect(monitor.getByRole('button', { name: 'Cancel run' })).toBeEnabled();
    expect(await fixture.evaluate((state) => state.attempts())).toBe(1);
    await monitor.getByRole('button', { name: 'Close' }).click();
    await request.fill('Keep this next idea.');
    await window.getByRole('button', { name: 'Open run monitor' }).click();
    await monitor.getByRole('button', { name: 'Cancel run' }).click();
    await expect(monitor).toContainText('Stopped');
    expect(await fixture.evaluate((state) => state.attempts())).toBe(2);
    await monitor.getByRole('button', { name: 'Close' }).click();
    await expect(window.getByText('Generation stopped', { exact: true })).toBeVisible();
    await expect(request).toHaveValue('Keep this next idea.');
    await expect(
      window.getByRole('log', { name: 'Conversation' }).getByText(/You asked:/),
    ).toHaveCount(1);
    await window.screenshot({ path: test.info().outputPath('stop-retried.png'), scale: 'css' });
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});
