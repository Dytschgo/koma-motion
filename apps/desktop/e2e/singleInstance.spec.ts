import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import electronPath from 'electron';
import {
  APPLICATION_DIRECTORY,
  getApplicationEnvironment,
  launchApplication,
  type RunningApplication,
} from './application';

let running: RunningApplication | undefined;

test.afterEach(async () => {
  await running?.close();
  running = undefined;
});

test('a second instance with the same data folder ends and focuses the first', async () => {
  running = await launchApplication();
  await expect(
    running.window.getByRole('heading', { name: /Presentations are frames/ }),
  ).toBeVisible();

  const second = spawn(
    electronPath as unknown as string,
    [APPLICATION_DIRECTORY, `--user-data-dir=${join(running.directory, 'user-data')}`],
    { cwd: APPLICATION_DIRECTORY, env: getApplicationEnvironment(), stdio: 'ignore' },
  );
  const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      second.kill();
      rejectExit(new Error('The second instance kept running.'));
    }, 20_000);
    second.once('exit', (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });

  expect(exitCode).toBe(0);
  expect(running.application.windows()).toHaveLength(1);
});
