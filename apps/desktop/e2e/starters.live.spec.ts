/**
 * Generates each starter with an agent CLI installed on this computer and
 * keeps the projects, screenshots and a video as evidence. It only runs on
 * request, because it uses the account of the person who runs it:
 *
 *   KOMA_LIVE_E2E=claude-code KOMA_LIVE_OUTPUT_DIR=<folder> pnpm test:e2e starters.live
 *
 * KOMA_LIVE_STARTER=<id> limits the run to one starter. KOMA_LIVE_MODEL
 * chooses a model; without it the CLI default is used.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { STARTER_PRESETS } from '@koma-motion/brand-kit';
import { komaProjectSchema } from '@koma-motion/core';
import { expect, test } from '@playwright/test';
import { chooseModel, selectProvider } from './composerControls';
import {
  answerSaveDialog,
  launchApplication,
  openSettingsPage,
  showInspector,
} from './application';

const provider = process.env['KOMA_LIVE_E2E'] ?? '';
const model = process.env['KOMA_LIVE_MODEL'] ?? '';
const only = process.env['KOMA_LIVE_STARTER'] ?? '';
const OUTPUT_DIRECTORY = process.env['KOMA_LIVE_OUTPUT_DIR']
  ? resolve(process.env['KOMA_LIVE_OUTPUT_DIR'])
  : resolve(import.meta.dirname, '../test-results/live-starters');
const TIME_LIMIT_SECONDS = 1500;

test.skip(provider === '', 'Live tests run on request');
test.setTimeout((TIME_LIMIT_SECONDS + 300) * 1000);

for (const starter of STARTER_PRESETS.filter((preset) => only === '' || preset.id === only)) {
  test(`generates the ${starter.name} starter`, async () => {
    const output = join(OUTPUT_DIRECTORY, starter.id);
    await mkdir(output, { recursive: true });
    const running = await launchApplication({ recordVideoDirectory: join(output, 'video') });
    const { window, application } = running;
    const stage = window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');
    const komas = window
      .getByRole('list', { name: 'Komas' })
      .getByRole('button', { name: /^Koma \d+:/ });
    const filePath = join(output, `${starter.id}.koma`);
    const started = Date.now();

    try {
      await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1480, 920);
      });
      await window
        .getByRole('list', { name: 'Starters' })
        .getByRole('button', { name: `Start ${starter.name}` })
        .click();
      await expect(window.getByLabel('Your request')).toHaveValue(starter.request);

      await openSettingsPage(window, 'Generation');
      await window.getByLabel('Stop generation after a time limit').check();
      await window.getByLabel('Time limit in seconds').fill(String(TIME_LIMIT_SECONDS));
      if (model !== '') {
        await chooseModel(
          window,
          `Model for ${provider === 'claude-code' ? 'Claude Code' : provider}`,
          model,
        );
      }
      await window.getByRole('button', { name: 'Done' }).click();
      await selectProvider(window, provider);

      await window.getByRole('button', { name: 'Generate Komas' }).click();
      await expect(window.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
      await expect(window.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0, {
        timeout: (TIME_LIMIT_SECONDS + 60) * 1000,
      });
      await window.screenshot({ path: join(output, 'result.png') });
      await expect(window.getByText(/^Generation (failed|stopped|took too long)$/)).toHaveCount(0);
      await expect(komas.first()).toBeVisible();

      await answerSaveDialog(application, filePath);
      await window.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(window.getByText('All changes saved')).toBeVisible();
      const saved = komaProjectSchema.parse(JSON.parse(await readFile(filePath, 'utf8')));

      // Hide the chat so the canvas has room for the slides.
      const hide = window.getByRole('button', { name: 'Hide the chat' });
      if (await hide.isVisible()) await hide.click();
      await showInspector(window);
      for (const [index] of saved.presentation.komas.entries()) {
        await komas.nth(index).click();
        await stage.screenshot({ path: join(output, `koma-${String(index + 1)}.png`) });
      }

      // Plays every transition at its generated duration and captures frames between Komas.
      for (const [index, transition] of saved.presentation.transitions.entries()) {
        const fromIndex = saved.presentation.komas.findIndex(
          (koma) => koma.id === transition.fromKomaId,
        );
        await komas.nth(fromIndex).click();
        await window.getByRole('button', { name: 'Preview', exact: true }).click();
        await expect(stage).toHaveAttribute('aria-label', /^Preview of the transition/);
        for (const fraction of [0.3, 0.6]) {
          await window.waitForTimeout(Math.round(transition.duration * 0.3));
          await stage.screenshot({
            path: join(
              output,
              `transition-${String(index + 1)}-${String(Math.round(fraction * 100))}.png`,
            ),
          });
        }
        await expect(stage).not.toHaveAttribute('aria-label', /^Preview of the transition/, {
          timeout: transition.duration + 15_000,
        });
        await window.waitForTimeout(600);
      }
      expect(running.problems).toEqual([]);

      await writeFile(
        join(output, 'verification.json'),
        JSON.stringify(
          {
            starter: starter.id,
            provider,
            model: model || 'CLI default',
            seconds: Math.round((Date.now() - started) / 1000),
            request: starter.request,
            komas: saved.presentation.komas.map((koma) => ({
              title: koma.title,
              elements: koma.elements.length,
            })),
            transitions: saved.presentation.transitions.map((transition) => ({
              strategy: transition.strategy,
              duration: transition.duration,
              easing: transition.easing,
              operations: transition.elementTransitions.length,
              rationale: transition.rationale,
            })),
          },
          null,
          2,
        ),
      );
    } finally {
      const video = window.video();
      await running.close();
      const recorded = await video?.path().catch(() => undefined);
      if (recorded !== undefined) {
        await rename(recorded, join(output, `${starter.id}.webm`)).catch(() => undefined);
      }
    }
  });
}
