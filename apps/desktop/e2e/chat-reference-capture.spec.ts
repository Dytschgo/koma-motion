import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApplication } from './application';

const root = process.env['KOMA_CHAT_EVIDENCE_DIR'];
const phase = process.env['KOMA_CHAT_PHASE'] ?? 'final';
test.skip(root === undefined, 'Set KOMA_CHAT_EVIDENCE_DIR to capture reference evidence.');

for (const width of [1480, 1120] as const) {
  test(`capture chat at ${String(width)}`, async () => {
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
      if (width === 1120) {
        await window.keyboard.press('Home');
      } else {
        for (let index = 0; index < 3; index += 1) await window.keyboard.press('ArrowLeft');
      }
      await window.screenshot({ path: join(output, `empty-studio-${String(width)}.png`) });
      await chat.screenshot({ path: join(output, `empty-chat-${String(width)}.png`) });
      await window.getByRole('button', { name: 'Use the example request' }).click();
      await window.getByRole('button', { name: 'Generate Komas' }).click();
      await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
      await window.screenshot({ path: join(output, `generated-studio-${String(width)}.png`) });
      await chat.screenshot({ path: join(output, `generated-chat-${String(width)}.png`) });
      expect(running.problems).toEqual([]);
      const viewport = await window.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        devicePixelRatio,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      }));
      const chatBounds = await chat.boundingBox();
      await writeFile(
        join(output, `manifest-${String(width)}.json`),
        JSON.stringify(
          {
            sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
            sourceStatus: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(),
            platform: process.platform,
            viewport,
            chatWidth: chatBounds?.width,
            captures: [
              `empty-studio-${String(width)}.png`,
              `empty-chat-${String(width)}.png`,
              `generated-studio-${String(width)}.png`,
              `generated-chat-${String(width)}.png`,
            ],
            behavior:
              'Native Electron: create project, use example request, generate three mock Komas, no renderer errors',
          },
          null,
          2,
        ),
      );
    } finally {
      await running.close();
    }
  });
}
