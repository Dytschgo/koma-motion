import { expect, test, type Page } from '@playwright/test';
import { launchApplication, showChat, type RunningApplication } from './application';

let running: RunningApplication | null = null;
test.afterEach(async () => {
  await running?.close();
  running = null;
});

async function start(env: Record<string, string>): Promise<Page> {
  running = await launchApplication({ env });
  const { window } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await showChat(window);
  await window.getByRole('button', { name: 'Use the example request' }).click();
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  return window;
}

function activity(window: Page) {
  return window.getByRole('log', { name: 'Conversation' }).locator('[data-run-phase]');
}

test('follows the observed phases and opens a monitor of the same run', async () => {
  const window = await start({ KOMA_MOCK_DELAY_MS: '3000' });
  await expect(activity(window)).toHaveAttribute('data-run-phase', 'generating');
  const sprite = activity(window).locator('svg.pixel-sprite');
  await expect(sprite).toHaveAttribute('data-phase', 'generating');
  await expect(sprite).toHaveAttribute('data-animated', '');
  await expect(activity(window).getByRole('status')).toContainText('Generating');

  const opener = window.getByRole('button', { name: 'Open run monitor' });
  await opener.click();
  const monitor = window.getByRole('dialog', { name: 'Run monitor' });
  await expect(monitor).toBeVisible();
  await expect(monitor).toContainText('Mock provider · built-in');
  await expect(monitor).toContainText('no terminal can attach');
  await expect(monitor.getByRole('region', { name: 'Output', exact: true })).toContainText(
    'Demo narration',
  );
  await expect(monitor.getByRole('region', { name: 'Timeline', exact: true })).toContainText(
    'Composing the Komas',
  );
  // The monitor watches the run as it goes on.
  await expect(monitor.getByRole('region', { name: 'Timeline', exact: true })).toContainText(
    'Choosing the choreography',
  );
  await window.keyboard.press('Escape');
  await expect(monitor).toBeHidden();
  await expect(opener).toBeFocused();

  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
  await expect(activity(window)).toHaveAttribute('data-run-phase', 'completed');
  await expect(activity(window)).toContainText('Completed after 0:0');
  await window.getByRole('button', { name: 'Run details' }).click();
  await expect(monitor.getByRole('region', { name: 'Timeline', exact: true })).toContainText(
    'The response is valid',
  );
  await expect(monitor).toContainText('1 of 2');
  await monitor.getByRole('button', { name: 'Close' }).click();

  // One request, one result: the monitor started nothing.
  const log = window.getByRole('log', { name: 'Conversation' });
  await expect(log.getByText(/You asked:/)).toHaveCount(1);
  await expect(log.getByText(/Created 3 Komas/)).toHaveCount(1);
  expect(running?.problems).toEqual([]);
});

test('shows checking, correcting and a failure when the answer stays invalid', async () => {
  const window = await start({ KOMA_MOCK_DELAY_MS: '1600', KOMA_MOCK_OUTCOME: 'invalid' });
  const seen = new Set<string>();
  await expect
    .poll(
      async () => {
        const phase = await activity(window).getAttribute('data-run-phase');
        if (phase !== null) seen.add(phase);
        return phase;
      },
      { intervals: [50] },
    )
    .toBe('failed');
  expect([...seen]).toEqual(expect.arrayContaining(['generating', 'repairing', 'failed']));
  await expect(window.getByText('Generation failed')).toBeVisible();
  await expect(activity(window)).toContainText('Failed after');
  await expect(activity(window).locator('svg.pixel-sprite')).not.toHaveAttribute(
    'data-animated',
    '',
  );
  await window.getByRole('button', { name: 'Run details' }).click();
  const monitor = window.getByRole('dialog', { name: 'Run monitor' });
  await expect(monitor).toContainText('2 of 2 (correction)');
  await expect(monitor.getByRole('region', { name: 'Timeline', exact: true })).toContainText(
    'Asking the provider to correct it once',
  );
  expect(running?.problems).toEqual([]);
});

test('cancels from the monitor and shows the stopped run', async () => {
  const window = await start({ KOMA_MOCK_DELAY_MS: '8000' });
  await window.getByRole('button', { name: 'Open run monitor' }).click();
  const monitor = window.getByRole('dialog', { name: 'Run monitor' });
  await monitor.getByRole('button', { name: 'Cancel run' }).click();
  await expect(monitor).toContainText('Stopped');
  await expect(monitor.getByRole('button', { name: 'Cancel run' })).toHaveCount(0);
  await monitor.getByRole('button', { name: 'Close' }).click();
  await expect(window.getByText('Generation stopped')).toBeVisible();
  await expect(activity(window)).toHaveAttribute('data-run-phase', 'cancelled');
  expect(running?.problems).toEqual([]);
});

test('keeps a still pose with reduced motion and survives hiding the chat during a long run', async () => {
  running = await launchApplication({ env: { KOMA_MOCK_DELAY_MS: '6000' } });
  const { window } = running;
  await window.emulateMedia({ reducedMotion: 'reduce' });
  await window.getByRole('button', { name: 'Create a project' }).click();
  await showChat(window);
  await window.getByRole('button', { name: 'Use the example request' }).click();
  await window.getByRole('button', { name: 'Generate Komas' }).click();

  const sprite = activity(window).locator('svg.pixel-sprite');
  await expect(sprite).toHaveAttribute('data-phase', 'generating');
  await expect(sprite).not.toHaveAttribute('data-animated', '');
  await expect(activity(window).getByRole('status')).toContainText('Generating');

  await window.getByRole('button', { name: 'Hide the chat' }).click();
  await expect(
    window.getByRole('button', { name: /Show the chat\. Komas are being generated/ }),
  ).toBeVisible();
  await window.waitForTimeout(2200);
  await window.getByRole('button', { name: /Show the chat/ }).click();
  await expect(activity(window)).toHaveAttribute('data-run-phase', 'generating');
  // Elapsed time kept counting while the chat was hidden.
  await expect(activity(window)).toContainText(/0:0[2-9]/);
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible({ timeout: 15_000 });
  await expect(activity(window)).toHaveAttribute('data-run-phase', 'completed');
  expect(running.problems).toEqual([]);
});
