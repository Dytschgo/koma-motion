import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApplication, type RunningApplication } from './application';

let running: RunningApplication;

test.beforeEach(async () => {
  running = await launchApplication();
});

test.afterEach(async () => {
  await running.close();
});

async function readStoredChannel(): Promise<unknown> {
  const text = await readFile(join(running.directory, 'user-data', 'preferences.json'), 'utf8');
  const preferences: unknown = JSON.parse(text);
  return preferences;
}

test('shows the version and uses the stable channel by default', async () => {
  const { window, application } = running;
  await window.getByRole('button', { name: 'Settings' }).click();

  const updates = window.getByRole('region', { name: 'App updates' });
  const version = await application.evaluate(({ app }) => app.getVersion());
  await expect(updates.getByText(`Installed version: ${version}`)).toBeVisible();
  await expect(updates.getByLabel('Update channel')).toHaveValue('stable');
  await expect(window.getByText('Nightly', { exact: true })).toHaveCount(0);
});

test('does not check for updates in a version that is not installed', async () => {
  const { window } = running;
  const requests: string[] = [];
  window.on('request', (request) => requests.push(request.url()));

  await window.getByRole('button', { name: 'Settings' }).click();
  await window.getByRole('button', { name: 'Check for updates' }).click();

  await expect(
    window.getByText('Updates are available in installed versions of Koma Motion.'),
  ).toBeVisible();
  expect(requests.filter((url) => !url.startsWith('koma://'))).toEqual([]);
});

test('asks before switching to nightly and keeps stable when declined', async () => {
  const { window } = running;
  await window.getByRole('button', { name: 'Settings' }).click();
  const channel = window.getByLabel('Update channel');

  await channel.selectOption('nightly');
  await expect(window.getByRole('heading', { name: 'Switch to nightly versions?' })).toBeVisible();
  await window.getByRole('button', { name: 'Keep stable' }).click();

  await expect(channel).toHaveValue('stable');
  await expect(readStoredChannel()).rejects.toThrow();
});

test('stores the chosen channel and uses it after a restart', async () => {
  const { window } = running;
  await window.getByRole('button', { name: 'Settings' }).click();
  await window.getByLabel('Update channel').selectOption('nightly');
  await window.getByRole('button', { name: 'Use nightly' }).click();

  await expect(window.getByLabel('Update channel')).toHaveValue('nightly');
  await expect(window.getByText(/Nightly versions contain unfinished changes/)).toBeVisible();
  await expect.poll(readStoredChannel).toEqual({ updateChannel: 'nightly' });

  await window.getByLabel('Update channel').selectOption('stable');
  await expect(window.getByLabel('Update channel')).toHaveValue('stable');
  await expect.poll(readStoredChannel).toEqual({ updateChannel: 'stable' });
});

test('refuses update requests that the contract does not describe', async () => {
  const outcome = await running.window.evaluate(async () => {
    const bridge = (globalThis as Record<string, unknown>)['komaMotion'] as {
      invoke(channel: string, request: unknown): Promise<unknown>;
    };
    const attempt = async (channel: string, request: unknown): Promise<string> => {
      try {
        await bridge.invoke(channel, request);
        return 'accepted';
      } catch {
        return 'rejected';
      }
    };
    return {
      unknownChannel: await attempt('koma:updates:set-channel', { channel: 'beta' }),
      feedUrl: await attempt('koma:updates:check', { feedUrl: 'https://example.com/' }),
      installerUrl: await attempt('koma:updates:download', { url: 'https://example.com/x.exe' }),
    };
  });
  expect(outcome).toEqual({
    unknownChannel: 'rejected',
    feedUrl: 'rejected',
    installerUrl: 'rejected',
  });
});
