/// <reference lib="dom" />
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildKoma, buildPresentation, buildProject, buildShape } from '@koma-motion/core/testing';
import type { KomaProject } from '@koma-motion/core';
import { buildTransition } from '@koma-motion/motion-engine';
import { serialiseProject } from '@koma-motion/project-format';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { answerOpenDialog, launchApplication, type RunningApplication } from './application';

let running: RunningApplication;

test.beforeEach(async () => {
  running = await launchApplication();
});

test.afterEach(async () => {
  await running.close();
});

function getStage(): Locator {
  return running.window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');
}

function serialise(project: KomaProject): string {
  const result = serialiseProject(project);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

async function openProject(window: Page, filePath: string): Promise<void> {
  await answerOpenDialog(running.application, filePath);
  await window.getByRole('button', { name: 'Open', exact: true }).click();
}

interface LayerFact {
  readonly id: string;
  readonly zIndex: string;
  readonly computed: string;
}

async function layerFacts(): Promise<LayerFact[]> {
  return getStage()
    .locator('[data-persistent-id]')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        id: element.getAttribute('data-persistent-id') ?? '',
        zIndex: element instanceof HTMLElement ? element.style.zIndex : '',
        computed: element instanceof HTMLElement ? getComputedStyle(element).zIndex : '',
      })),
    );
}

test('keeps source stacking in the middle of a valid transition', async () => {
  const { window, directory, problems } = running;
  const alpha = buildShape({
    id: 'alpha-1',
    persistentId: 'alpha',
    name: 'Alpha',
    zIndex: 1,
    position: { x: 160, y: 180 },
    size: { width: 320, height: 240 },
  });
  const beta = buildShape({
    id: 'beta-1',
    persistentId: 'beta',
    name: 'Beta',
    zIndex: 1,
    position: { x: 280, y: 260 },
    size: { width: 320, height: 240 },
  });
  const from = buildKoma({ id: 'koma-1', title: 'Source order', elements: [alpha, beta] });
  const to = buildKoma({
    id: 'koma-2',
    title: 'Target order',
    elements: [
      { ...beta, id: 'beta-2' },
      { ...alpha, id: 'alpha-2', zIndex: 5 },
    ],
  });
  const built = buildTransition({ id: 'transition-1', from, to, suggestion: { easing: 'linear' } });
  if (!built.ok) {
    throw new Error('Expected a transition');
  }
  const filePath = join(directory, 'stacking.koma');
  const text = serialise(
    buildProject({
      name: 'Stacking',
      presentation: buildPresentation({
        komas: [from, to],
        transitions: [built.value.transition],
      }),
    }),
  );
  await writeFile(filePath, text);

  await openProject(window, filePath);
  await expect(window.getByLabel('Project name')).toHaveValue('Stacking');
  await expect(getStage()).toHaveAttribute('aria-label', 'Koma 1: Source order');

  await window.getByLabel('Position in the transition').fill('500');
  await expect(getStage()).toHaveAttribute('aria-label', /^Preview of the transition/);
  await expect.poll(layerFacts).toEqual([
    { id: 'alpha', zIndex: '1', computed: '1' },
    { id: 'beta', zIndex: '1', computed: '1' },
  ]);

  await window.getByLabel('Position in the transition').fill('1000');
  await expect.poll(layerFacts).toEqual([
    { id: 'beta', zIndex: '1', computed: '1' },
    { id: 'alpha', zIndex: '5', computed: '5' },
  ]);
  expect(await readFile(filePath, 'utf8')).toBe(text);
  expect(problems).toEqual([]);
});

test('blocks a false element reference until the transition is regenerated', async () => {
  const { window, directory, problems } = running;
  const source = buildShape({
    id: 'shape-1',
    persistentId: 'marker',
    name: 'Marker',
    position: { x: 120, y: 200 },
    size: { width: 240, height: 180 },
  });
  const target = { ...source, id: 'shape-2', position: { x: 860, y: 200 } };
  const from = buildKoma({ id: 'koma-1', title: 'Start', elements: [source] });
  const to = buildKoma({ id: 'koma-2', title: 'End', elements: [target] });
  const built = buildTransition({ id: 'transition-1', from, to, suggestion: { easing: 'linear' } });
  if (!built.ok) {
    throw new Error('Expected a transition');
  }
  const invented = {
    ...built.value.transition,
    elementTransitions: [
      {
        persistentId: 'marker',
        operation: 'move' as const,
        from: { elementId: 'shape-1', position: { x: 0, y: 0 } },
        to: { elementId: 'missing-shape', position: { x: 1800, y: 900 } },
      },
    ],
  };
  const filePath = join(directory, 'false-reference.koma');
  const text = serialise(
    buildProject({
      name: 'False reference',
      presentation: buildPresentation({ komas: [from, to], transitions: [invented] }),
    }),
  );
  await writeFile(filePath, text);

  await openProject(window, filePath);
  await expect(window.getByLabel('Project name')).toHaveValue('False reference');
  const warning = window.getByRole('region', { name: /Transition 1 to 2\./ });
  await warning.getByRole('button', { name: 'Details' }).click();
  await expect(warning).toContainText('The stored motion is damaged.');
  await expect(warning).toContainText('missing-shape');

  // Damaged motion is not played and cannot be scrubbed.
  const position = window.getByLabel('Position in the transition');
  await expect(position).toBeDisabled();
  await expect(window.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();

  // Regenerating rebuilds the motion from the Komas, not from the false reference.
  await warning.getByRole('button', { name: 'Regenerate transition' }).click();
  await expect(warning).toHaveCount(0);
  // Measured once the warning is gone: the canvas grows into its space.
  const atRest = await getStage().locator('[data-persistent-id="marker"]').boundingBox();
  if (atRest === null) {
    throw new Error('The marker is not on the canvas');
  }
  await position.fill('500');
  await expect(getStage()).toHaveAttribute('aria-label', /^Preview of the transition/);
  const middle = await getStage().locator('[data-persistent-id="marker"]').boundingBox();
  if (middle === null) {
    throw new Error('The marker left the canvas');
  }
  expect(middle.x).toBeGreaterThan(atRest.x + 30);
  expect(Math.abs(middle.y - atRest.y)).toBeLessThan(2);

  await position.fill('1000');
  const end = await getStage().locator('[data-persistent-id="marker"]').boundingBox();
  if (end === null) {
    throw new Error('The marker is missing at the end of the transition');
  }
  expect(end.x).toBeGreaterThan(middle.x + 30);
  expect(await readFile(filePath, 'utf8')).toBe(text);
  expect(problems).toEqual([]);
});
