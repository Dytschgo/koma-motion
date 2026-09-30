import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApplication, showInspector, type RunningApplication } from './application';

const root = process.env['KOMA_UI_EVIDENCE_DIR'];
const phase = process.env['KOMA_UI_PHASE'] ?? 'after';
let running: RunningApplication;

test.skip(root === undefined, 'Set KOMA_UI_EVIDENCE_DIR to write UI evidence.');

test.beforeEach(async () => {
  running = await launchApplication();
});

test.afterEach(async () => {
  await running.close();
});

test('capture welcome and studio at wide and narrow sizes', async () => {
  const { application, window, problems } = running;
  const output = join(root!, phase);
  await mkdir(output, { recursive: true });
  const captures: Record<string, { width: number; height: number; scale: number }> = {};
  const capture = async (name: string, width: number): Promise<void> => {
    await application.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size, 920);
    }, width);
    await expect.poll(() => window.evaluate(() => innerWidth)).toBe(width);
    const dimensions = await window.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scale: devicePixelRatio,
    }));
    await window.screenshot({ path: join(output, `${name}-${width}.png`) });
    captures[`${name}-${width}.png`] = dimensions;
  };
  for (const width of [1480, 1120]) {
    await capture('welcome', width);
  }
  if (phase.startsWith('after')) {
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1480, 920);
    });
    await expect.poll(() => window.evaluate(() => innerWidth)).toBe(1480);
    const help = window.getByRole('button', { name: 'About Koma Motion project files' });
    await help.focus();
    await expect(window.getByRole('tooltip')).toBeVisible();
    await help.press('Escape');
    await expect(window.getByRole('tooltip')).toHaveCount(0);
    await help.click();
    await expect(window.getByRole('tooltip')).toBeVisible();
    await capture('welcome-help', 1480);
    await window.getByRole('heading', { name: /Presentations are frames/ }).click();
    await expect(window.getByRole('tooltip')).toHaveCount(0);
  }
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1480, 920);
  });
  await expect.poll(() => window.evaluate(() => innerWidth)).toBe(1480);
  await window.getByRole('button', { name: 'Create a project' }).click();
  await expect(window.getByLabel('Project name')).toBeVisible();
  for (const width of [1480, 1120]) {
    await capture('studio', width);
  }
  await window.getByRole('button', { name: 'Use the example request' }).click();
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  await expect(
    window.getByRole('list', { name: 'Komas' }).getByRole('button', { name: /^Koma \d:/ }),
  ).toHaveCount(3);
  for (const width of [1480, 1120]) {
    await application.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size, 920);
    }, width);
    await expect.poll(() => window.evaluate(() => innerWidth)).toBe(width);
    await showInspector(window);
    await capture('generated', width);
  }
  expect(problems).toEqual([]);
  await writeFile(
    join(output, 'manifest.json'),
    JSON.stringify(
      {
        sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        sourceStatus: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(),
        phase,
        platform: process.platform,
        reducedMotion: await window.evaluate(
          () => matchMedia('(prefers-reduced-motion: reduce)').matches,
        ),
        captures,
        behavior:
          'Native Electron: welcome, create project, mock generate three Komas, Inspector visible, no renderer errors',
      },
      null,
      2,
    ),
  );
});
