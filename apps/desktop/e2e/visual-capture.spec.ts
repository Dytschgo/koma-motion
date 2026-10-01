import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  launchApplication,
  openSettingsPage,
  showChat,
  showInspector,
  type RunningApplication,
} from './application';

/**
 * Screens of the whole application for visual review. Writes nothing unless
 * KOMA_VISUAL_EVIDENCE_DIR names a folder; KOMA_VISUAL_PHASE names the subfolder.
 */
const root = process.env['KOMA_VISUAL_EVIDENCE_DIR'];
const phase = process.env['KOMA_VISUAL_PHASE'] ?? 'after';

test.skip(root === undefined, 'Set KOMA_VISUAL_EVIDENCE_DIR to capture visual evidence.');

const SIZES = [
  { width: 1480, height: 920, reducedMotion: false },
  { width: 1120, height: 700, reducedMotion: true },
] as const;

let running: RunningApplication;
test.afterEach(async () => {
  await running.close();
});

for (const size of SIZES) {
  test(`captures every main screen at ${String(size.width)}x${String(size.height)}`, async () => {
    // A slower mock leaves time to capture the running state.
    running = await launchApplication({ env: { KOMA_MOCK_DELAY_MS: '4000' } });
    const { application, window } = running;
    const output = join(root!, phase, `${String(size.width)}x${String(size.height)}`);
    await mkdir(output, { recursive: true });
    await window.emulateMedia({ reducedMotion: size.reducedMotion ? 'reduce' : 'no-preference' });
    await application.evaluate(({ BrowserWindow }, { width, height }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(width, height);
    }, size);
    await expect.poll(() => window.evaluate(() => innerWidth)).toBe(size.width);
    const shot = async (name: string, page: Page = window): Promise<void> => {
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(output, `${name}.png`) });
    };

    await shot('01-welcome');
    await window.getByRole('button', { name: 'Create a project' }).click();
    await showChat(window);
    await shot('02-empty-project');

    await window.getByRole('button', { name: 'Use the example request' }).click();
    await window.getByRole('button', { name: 'Generate Komas' }).click();
    await expect(window.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await shot('03-generating');
    await window.getByRole('button', { name: 'Open run monitor' }).click();
    await shot('03b-run-monitor');
    await window.keyboard.press('Escape');
    await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
    await shot('04-generated-chat');

    await showInspector(window);
    await shot('05-inspector-koma');
    await window.getByRole('tab', { name: 'Motion' }).click();
    await shot('06-inspector-motion');
    await window.getByRole('tab', { name: 'Element' }).click();
    await shot('07-inspector-element');

    await window.getByRole('button', { name: 'Brand Kit', exact: true }).click();
    await shot('08-brand-kit');
    await window.getByRole('button', { name: 'Close panel' }).click();

    await openSettingsPage(window, 'Generation');
    await shot('09-settings-generation');
    await openSettingsPage(window, 'Providers');
    await shot('10-settings-providers');
    await window.getByRole('button', { name: 'Done' }).click();

    await window.getByRole('button', { name: 'Project health' }).click();
    await shot('11-project-health');
    await window.keyboard.press('Escape');

    await window.getByRole('button', { name: 'New', exact: true }).click();
    const confirm = window.getByRole('alertdialog');
    if (await confirm.isVisible().catch(() => false)) {
      await shot('12-confirm');
      await window.keyboard.press('Escape');
    }
    await writeFile(
      join(output, 'capture.json'),
      JSON.stringify({ ...size, phase, problems: running.problems }, null, 2),
    );
  });
}
