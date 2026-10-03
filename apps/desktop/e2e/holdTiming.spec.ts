import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { komaProjectSchema } from '@koma-motion/core';
import { buildKoma, buildPresentation, buildProject, buildShape } from '@koma-motion/core/testing';
import { buildTransition } from '@koma-motion/motion-engine';
import { expect, test } from '@playwright/test';
import {
  answerOpenDialog,
  answerSaveDialog,
  launchApplication,
  showInspector,
  type RunningApplication,
} from './application';

let running: RunningApplication;
test.beforeEach(async () => {
  running = await launchApplication();
});
test.afterEach(async () => {
  await running.close();
});

for (const reducedMotion of [false, true]) {
  test(`saved holds survive undo and reopening, autoplay pause/resume and the final Koma (reduced motion: ${String(reducedMotion)})`, async () => {
    const { window, application, directory } = running;
    await window.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
    const komas = [100, 400, 700].map((x, index) =>
      buildKoma({
        id: `koma-${String(index + 1)}`,
        title: `Frame ${String(index + 1)}`,
        elements: [
          buildShape({
            id: `shape-${String(index + 1)}`,
            persistentId: 'mover',
            position: { x, y: 100 },
          }),
        ],
      }),
    );
    const transitions = komas.slice(0, -1).map((from, index) => {
      const built = buildTransition({
        id: `transition-${String(index + 1)}`,
        from,
        to: komas[index + 1]!,
        suggestion: { duration: 1000 },
      });
      if (!built.ok) throw new Error('Expected a playable fixture');
      return built.value.transition;
    });
    const project = buildProject({
      name: 'Saved hold timing',
      presentation: buildPresentation({ komas, transitions }),
    });
    const source = join(directory, 'source.koma');
    const original = JSON.stringify(project);
    await writeFile(source, original);
    await answerOpenDialog(application, source);
    await window.getByRole('button', { name: 'Open', exact: true }).click();
    await showInspector(window);
    await window.getByRole('tab', { name: 'Koma', exact: true }).click();
    const global = window.getByRole('switch', { name: 'Use global hold duration' });
    const seconds = window.getByLabel('Koma hold duration in seconds');
    await expect(global).toBeChecked();
    await expect(seconds).toBeDisabled();
    await global.uncheck();
    await seconds.fill('1');
    await window
      .getByRole('list', { name: 'Komas' })
      .getByRole('button', { name: /^Koma 2:/ })
      .click();
    await global.uncheck();
    await seconds.fill('2.5');
    await window.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(global).toBeChecked();
    await window.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(global).not.toBeChecked();
    await expect(seconds).toHaveValue('2.5');
    const savedPath = join(directory, 'timed.koma');
    await answerSaveDialog(application, savedPath);
    await window.getByRole('button', { name: 'Save as', exact: true }).click();
    await expect(window.getByText('All changes saved', { exact: true })).toBeVisible();
    const saved = komaProjectSchema.parse(JSON.parse(await readFile(savedPath, 'utf8')));
    expect(saved.presentation.komas.map((koma) => koma.holdDurationMs)).toEqual([1000, 2500, null]);
    expect(saved.presentation.transitions).toEqual(transitions);
    expect(await readFile(source, 'utf8')).toBe(original);
    await answerOpenDialog(application, savedPath);
    await window.getByRole('button', { name: 'Open', exact: true }).click();
    await window
      .getByRole('list', { name: 'Komas' })
      .getByRole('button', { name: /^Koma 2:/ })
      .click();
    await expect(seconds).toHaveValue('2.5');
    await window.screenshot({ path: test.info().outputPath('saved-koma-hold.png') });

    await window.clock.install();
    await window.clock.pauseAt(Date.now() + 1000);
    await window.keyboard.press('F5');
    const player = window.getByRole('dialog', { name: 'Presentation', exact: true });
    const stage = player.locator('[data-koma-stage]');
    const controls = player.getByRole('group', { name: 'Presentation controls' });
    await expect(stage).toHaveAttribute('aria-label', /^Koma 1 of 3:/);
    await controls.getByRole('switch', { name: 'Autoplay' }).check();
    await expect(controls.getByLabel('Global hold duration in seconds')).toHaveValue('5');
    await window.clock.runFor(800);
    await expect(stage).toHaveAttribute('aria-label', /^Koma 1 of 3:/);
    await controls.getByRole('button', { name: 'Pause', exact: true }).click();
    await window.clock.runFor(10000);
    await expect(stage).toHaveAttribute('aria-label', /^Koma 1 of 3:/);
    await controls.getByRole('button', { name: 'Resume', exact: true }).click();
    await window.clock.runFor(199);
    await expect(stage).toHaveAttribute('aria-label', /^Koma 1 of 3:/);
    await window.clock.runFor(20);
    await expect(stage).toHaveAttribute('aria-label', /^Transition from /);
    await window.clock.runFor(reducedMotion ? 450 : 1050);
    await expect(stage).toHaveAttribute('aria-label', /^Koma 2 of 3:/);
    await window.clock.runFor(2000);
    await expect(stage).toHaveAttribute('aria-label', /^Koma 2 of 3:/);
    await window.clock.runFor(600);
    await expect(stage).toHaveAttribute('aria-label', /^Transition from /);
    await window.clock.runFor(reducedMotion ? 450 : 1050);
    await expect(stage).toHaveAttribute('aria-label', /^Koma 3 of 3:/);
    await expect(controls).toContainText('End');
    await window.clock.runFor(60000);
    await expect(stage).toHaveAttribute('aria-label', /^Koma 3 of 3:/);
    await expect(controls.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await window.screenshot({ path: test.info().outputPath('timed-presentation-end.png') });
    await window.keyboard.press('Escape');
    expect(running.problems).toEqual([]);
  });
}
