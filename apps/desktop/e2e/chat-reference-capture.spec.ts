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
    const running = await launchApplication({ env: { KOMA_MOCK_DELAY_MS: '1800' } });
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
      const divider = window.getByRole('separator', { name: 'Resize studio dock' });
      await divider.focus();
      if (width === 1120) {
        await window.keyboard.press('Home');
      } else {
        for (let index = 0; index < 3; index += 1) await window.keyboard.press('ArrowLeft');
      }
      await window.screenshot({
        path: join(output, `empty-studio-${String(width)}.png`),
        scale: 'css',
      });
      await chat.screenshot({
        path: join(output, `empty-chat-${String(width)}.png`),
        scale: 'css',
      });
      await window.getByRole('button', { name: 'Use the example request' }).click();
      await window.getByRole('button', { name: 'Generate Komas' }).click();
      await expect(chat.getByRole('region', { name: 'Output from Mock provider' })).toContainText(
        'Demo narration',
      );
      await chat.screenshot({
        path: join(output, `working-chat-${String(width)}.png`),
        scale: 'css',
      });
      await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
      await window.screenshot({
        path: join(output, `generated-studio-${String(width)}.png`),
        scale: 'css',
      });
      await chat.screenshot({
        path: join(output, `generated-chat-${String(width)}.png`),
        scale: 'css',
      });

      const request = window.getByLabel('Your request');
      const log = chat.getByRole('log', { name: 'Conversation' });
      await request.fill('Explore another way to tell the story.');
      await request.press('Enter');
      await expect(chat.getByRole('region', { name: 'Output from Mock provider' })).toContainText(
        'Demo narration',
      );
      await window.getByRole('button', { name: 'Stop generating' }).click();
      await expect(log.getByText('Generation stopped')).toBeVisible();
      await expect(request).toBeFocused();
      await request.fill('Keep this separate follow-up draft.');
      await chat.screenshot({
        path: join(output, `stopped-chat-${String(width)}.png`),
        scale: 'css',
      });
      await log.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(log.getByText(/Created 3 Komas/)).toHaveCount(2);
      await expect(request).toHaveValue('Keep this separate follow-up draft.');
      await chat.screenshot({
        path: join(output, `retried-chat-${String(width)}.png`),
        scale: 'css',
      });
      await log.evaluate((element) => {
        element.scrollTop = 0;
        element.dispatchEvent(new Event('scroll'));
      });
      const latest = chat.getByRole('button', { name: 'Jump to latest' });
      await expect(latest).toBeVisible();
      await chat.screenshot({
        path: join(output, `history-chat-${String(width)}.png`),
        scale: 'css',
      });
      await latest.click();
      await expect(latest).toBeHidden();
      await expect(log).toBeFocused();
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
            sourceRevision:
              process.env['KOMA_CHAT_SOURCE_REVISION'] ??
              execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
            sourceStatus:
              process.env['KOMA_CHAT_SOURCE_STATUS'] ??
              execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(),
            platform: process.platform,
            viewport,
            chatWidth: chatBounds?.width,
            captures: [
              `empty-studio-${String(width)}.png`,
              `empty-chat-${String(width)}.png`,
              `working-chat-${String(width)}.png`,
              `generated-studio-${String(width)}.png`,
              `generated-chat-${String(width)}.png`,
              `stopped-chat-${String(width)}.png`,
              `retried-chat-${String(width)}.png`,
              `history-chat-${String(width)}.png`,
            ],
            behavior:
              'Native Electron: generate mock Komas, stop a second run, retry without losing a separate draft, browse history and jump to latest with retained focus; no renderer errors',
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
