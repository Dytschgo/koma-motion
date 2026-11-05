import { createSeededIdGenerator } from '@koma-motion/core';
import {
  buildKoma,
  buildPresentation,
  buildProject,
  buildShape,
  buildText,
} from '@koma-motion/core/testing';
import { syncTransitions } from '@koma-motion/motion-engine';
import { serialiseProject } from '@koma-motion/project-format';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { answerOpenDialog, launchApplication } from './application';

/** Fixed workload: 100 Komas, each with 20 shapes and 20 text elements. */
function buildDenseDeck() {
  const komas = Array.from({ length: 100 }, (_, index) =>
    buildKoma({
      id: `dense-${String(index)}`,
      title: `Scene ${String(index + 1)}`,
      purpose: `Explain chapter ${String(index + 1)} of the story`,
      elements: Array.from({ length: 20 }, (_, item) => [
        buildShape({
          id: `shape-${String(index)}-${String(item)}`,
          persistentId: `shape-${String(item)}`,
          position: { x: 50 + (item % 5) * 360, y: 60 + Math.floor(item / 5) * 240 },
        }),
        buildText({
          id: `text-${String(index)}-${String(item)}`,
          persistentId: `text-${String(item)}`,
          content: { text: `Scene ${String(index + 1)} · Detail ${String(item + 1)}` },
          position: { x: 60 + (item % 5) * 360, y: 140 + Math.floor(item / 5) * 240 },
        }),
      ]).flat(),
    }),
  );
  return buildProject({
    name: 'Dense deck eval',
    presentation: syncTransitions(
      buildPresentation({ komas, transitions: [] }),
      createSeededIdGenerator('dense-deck'),
    ).presentation,
  });
}

test('dense deck rendering eval retains navigation without rendering every thumbnail', async () => {
  test.setTimeout(120_000);
  const running = await launchApplication();
  const { window, application } = running;
  try {
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1480, 920);
    });
    await window.emulateMedia({ reducedMotion: 'reduce' });
    const encoded = serialiseProject(buildDenseDeck());
    if (!encoded.ok) throw new Error(encoded.error.message);
    const source = join(running.directory, 'dense.koma');
    await writeFile(source, encoded.value);
    await answerOpenDialog(application, source);
    const started = performance.now();
    await window.getByRole('button', { name: 'Open a project', exact: true }).click();
    const strip = window.getByRole('list', { name: 'Komas', exact: true });
    await expect(strip.getByRole('button', { name: /^Koma \d+:/ })).toHaveCount(100);
    await expect(strip.locator('[data-koma-stage]').first()).toBeVisible();
    const openMs = performance.now() - started;
    const initialStages = await strip.locator('[data-koma-stage]').count();
    const initialNodes = await strip.locator('*').count();
    const samples: number[] = [];
    const cdp = await window.context().newCDPSession(window);
    await cdp.send('Performance.enable');
    for (let sample = 0; sample < 6; sample++) {
      const before = await cdp.send('Performance.getMetrics');
      await window.getByLabel('Project name').fill(`Dense deck eval ${String(sample)}`);
      await window.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const after = await cdp.send('Performance.getMetrics');
      const task = (metrics: { metrics: { name: string; value: number }[] }) =>
        metrics.metrics.find((metric) => metric.name === 'TaskDuration')?.value ?? 0;
      samples.push((task(after) - task(before)) * 1000);
    }
    await window.getByRole('button', { name: /^Deck overview/ }).click();
    const overview = window.getByRole('dialog', { name: 'Deck overview', exact: true });
    await expect(overview.getByLabel('Find a Koma')).toBeFocused();
    await window.screenshot({ path: test.info().outputPath('dense-overview.png'), scale: 'css' });
    await overview.getByLabel('Find a Koma').fill('Scene 100');
    await overview.getByLabel('Find a Koma').press('Enter');
    const last = strip.getByRole('button', { name: 'Koma 100: Scene 100', exact: true });
    await expect(last).toHaveAttribute('aria-current', 'true');
    await expect(last).toBeInViewport();
    await expect(last.locator('..').locator('[data-koma-stage]')).toBeVisible();
    await expect(last.locator('..')).toContainText('Scene 100 · Detail 1');
    await window.screenshot({ path: test.info().outputPath('dense-last-koma.png'), scale: 'css' });
    await test.info().attach('dense-deck-eval', {
      body: JSON.stringify(
        {
          komas: 100,
          elementsPerKoma: 40,
          openMs,
          initialStages,
          initialNodes,
          projectRenameTaskMs: samples,
          contentSize: await window.evaluate(() => ({ width: innerWidth, height: innerHeight })),
          reducedMotion: true,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    // Structural budgets catch eager rendering without a machine-dependent clock threshold.
    expect(initialStages).toBeLessThanOrEqual(12);
    expect(initialNodes).toBeLessThanOrEqual(4_000);
    await expect.poll(() => strip.locator('[data-koma-stage]').count()).toBeLessThanOrEqual(12);
    await expect(
      strip.locator('[data-koma-drag-item]').first().locator('[data-koma-stage]'),
    ).toHaveCount(0);
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});
