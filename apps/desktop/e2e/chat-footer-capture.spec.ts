import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApplication, openSettingsPage } from './application';

const root = process.env['KOMA_FOOTER_EVIDENCE_DIR'];
const phase = process.env['KOMA_FOOTER_PHASE'] ?? 'final';
test.skip(root === undefined, 'Set KOMA_FOOTER_EVIDENCE_DIR to capture footer evidence.');

for (const width of [1480, 1120] as const) {
  test(`capture footer at ${String(width)}`, async () => {
    const running = await launchApplication();
    const { window, application } = running;
    try {
      const output = join(root!, phase);
      await mkdir(output, { recursive: true });
      await application.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(size, 920);
      }, width);
      await expect.poll(() => window.evaluate(() => innerWidth)).toBe(width);
      await window.getByRole('button', { name: 'Create a project' }).click();
      const chat = window.getByRole('region', { name: 'Agent chat' });
      const divider = window.getByRole('separator', { name: 'Resize the chat' });
      await divider.focus();
      if (width === 1120) await window.keyboard.press('Home');
      else for (let index = 0; index < 3; index += 1) await window.keyboard.press('ArrowLeft');
      await chat.screenshot({ path: join(output, `closed-${String(width)}.png`) });

      await window.getByRole('button', { name: 'Provider and model' }).click();
      await chat.screenshot({ path: join(output, `provider-open-${String(width)}.png`) });
      await window
        .getByRole('dialog', { name: 'Provider and model' })
        .getByLabel('Provider', { exact: true })
        .selectOption('claude-code');
      await window.getByRole('button', { name: 'Provider and model' }).click();
      await openSettingsPage(window, 'Generation');
      await window.getByLabel('Model for Claude Code').fill('opus');
      await window.getByRole('button', { name: 'Done', exact: true }).click();
      await chat.screenshot({ path: join(output, `claude-closed-${String(width)}.png`) });
      await chat.locator('form').screenshot({ path: join(output, `footer-${String(width)}.png`) });
      await window.getByRole('button', { name: 'Provider and model' }).click();
      await chat.screenshot({ path: join(output, `claude-open-${String(width)}.png`) });
      await window.getByRole('button', { name: 'Provider and model' }).click();

      await window.getByRole('button', { name: 'Koma count', exact: true }).click();
      await chat.screenshot({ path: join(output, `count-open-${String(width)}.png`) });
      await window.keyboard.press('Escape');
      await window.getByRole('button', { name: 'Provider and model' }).click();
      await window
        .getByRole('dialog', { name: 'Provider and model' })
        .getByLabel('Provider', { exact: true })
        .selectOption('mock');
      await window.getByRole('button', { name: 'Provider and model' }).click();
      await window.getByRole('button', { name: 'Use the example request' }).click();
      await window.getByRole('button', { name: 'Generate Komas' }).click();
      await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
      await chat.screenshot({ path: join(output, `generated-${String(width)}.png`) });
      await window.screenshot({ path: join(output, `studio-${String(width)}.png`) });
      const layout = await window.evaluate(() => {
        const region = document.querySelector('[aria-label="Agent chat"]');
        return {
          viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
          chatWidth: region?.getBoundingClientRect().width ?? null,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        };
      });
      await writeFile(
        join(output, `manifest-${String(width)}.json`),
        JSON.stringify(
          {
            sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
            sourceStatus: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(),
            nativeElectron: true,
            provider: 'mock for generation; Claude Code configured without generation',
            phase,
            files: [
              `closed-${String(width)}.png`,
              `provider-open-${String(width)}.png`,
              `claude-closed-${String(width)}.png`,
              `footer-${String(width)}.png`,
              `claude-open-${String(width)}.png`,
              `count-open-${String(width)}.png`,
              `generated-${String(width)}.png`,
              `studio-${String(width)}.png`,
            ],
            ...layout,
          },
          null,
          2,
        ),
      );
      expect(running.problems).toEqual([]);
    } finally {
      await running.close();
    }
  });
}
