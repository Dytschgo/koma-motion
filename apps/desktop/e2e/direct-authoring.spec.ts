import { createSeededIdGenerator, komaProjectSchema } from '@koma-motion/core';
import { buildKoma, buildPresentation, buildProject, buildText } from '@koma-motion/core/testing';
import { syncTransitions } from '@koma-motion/motion-engine';
import { serialiseProject } from '@koma-motion/project-format';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  answerOpenDialog,
  answerSaveDialog,
  launchApplication,
  type RunningApplication,
} from './application';

let running: RunningApplication;
test.beforeEach(async () => {
  running = await launchApplication();
});
test.afterEach(async () => {
  await running.close();
});

function stage() {
  return running.window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');
}

test('authors a blank Koma without generation, selects each object, and saves/reopens all four kinds', async () => {
  const { window, application, directory } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await expect(window.getByRole('button', { name: 'Add text', exact: true })).toBeDisabled();
  await window.getByRole('button', { name: 'Add first Koma' }).click();
  await expect(stage()).toBeVisible();
  await expect(window.getByLabel('Element to add')).toBeFocused();
  await window.getByRole('button', { name: 'Brand Kit', exact: true }).click();
  await expect(
    window.getByText(
      'New elements and future generations use this kit. Existing elements keep their styling.',
    ),
  ).toBeVisible();
  await window.getByLabel('Primary colour').fill('#123456');
  await window.getByLabel('Body font').fill('Georgia');
  await window.getByRole('button', { name: 'Close panel', exact: true }).click();

  for (const [index, kind] of ['text', 'rectangle', 'circle', 'line'].entries()) {
    await window.getByLabel('Element to add').selectOption(kind);
    await window.getByRole('button', { name: `Add ${kind}`, exact: true }).click();
    await expect(stage().locator('[data-element-id]')).toHaveCount(index + 1);
    const name = kind[0]?.toUpperCase() + kind.slice(1);
    await expect(
      stage().getByRole('button', {
        name: `${name} (${kind === 'text' ? 'text' : 'shape'})`,
        exact: true,
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    await window.getByRole('button', { name: 'Inspect selected element' }).click();
    const inspector = window.getByRole('complementary', { name: 'Inspector' });
    await expect(inspector.getByRole('heading', { name: 'Selected element' })).toBeVisible();
    if (kind === 'text') {
      await expect(inspector.getByLabel('Text', { exact: true })).toHaveValue('Your text');
    } else {
      await expect(inspector.getByLabel('Shape', { exact: true })).toHaveValue(kind);
    }
    await window.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(stage().locator('[data-element-id]')).toHaveCount(index);
    await window.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(stage().locator('[data-element-id]')).toHaveCount(index + 1);
  }

  const path = join(directory, 'authored.koma');
  await answerSaveDialog(application, path);
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('All changes saved')).toBeVisible();
  const saved = komaProjectSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  const elements = saved.presentation.komas[0]?.elements;
  expect(elements).toHaveLength(4);
  expect(elements?.[0]).toMatchObject({ type: 'text', style: { fontFamily: 'Georgia' } });
  expect(
    elements?.slice(1).map((element) => (element.type === 'shape' ? element.style : null)),
  ).toEqual([
    { fill: '#123456', stroke: null, strokeWidth: 0 },
    { fill: '#123456', stroke: null, strokeWidth: 0 },
    { fill: null, stroke: '#123456', strokeWidth: 4 },
  ]);
  expect(saved.generationHistory).toEqual([]);
  await answerOpenDialog(application, path);
  await window.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(stage().locator('[data-element-id]')).toHaveCount(4);
  for (const element of elements ?? []) {
    await expect(stage().locator(`[data-element-id="${element.id}"]`)).toBeVisible();
  }
  await window.screenshot({ path: test.info().outputPath('authored-reopened.png'), scale: 'css' });
  expect(running.problems).toEqual([]);
});

test('narrow pointer and keyboard selection expose Inspect while preserving draft and focus, and keep motion explicit', async () => {
  const { window, application, directory } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 800);
  });
  await window.emulateMedia({ reducedMotion: 'reduce' });
  const text = buildText({ name: 'Existing text' });
  const from = buildKoma({ title: 'Author here', elements: [text] });
  const to = buildKoma({
    id: 'koma-2',
    title: 'Next state',
    elements: [{ ...text, id: 'text-2' }],
  });
  const project = buildProject({
    name: 'Direct authoring fixture',
    presentation: syncTransitions(
      buildPresentation({ komas: [from, to], transitions: [] }),
      createSeededIdGenerator('authoring-e2e'),
    ).presentation,
  });
  const encoded = serialiseProject(project);
  if (!encoded.ok) throw new Error(encoded.error.message);
  const source = join(directory, 'source.koma');
  await writeFile(source, encoded.value);
  await answerOpenDialog(application, source);
  await window.getByRole('button', { name: 'Open a project', exact: true }).click();
  await expect(window.getByLabel('Project name')).toHaveValue(project.name);
  const request = window.getByLabel('Your request');
  const draft = 'Keep this unfinished chat request';
  await request.fill(draft);
  const existing = stage().getByRole('button', { name: 'Existing text (text)', exact: true });
  await existing.click();
  const inspector = window.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector).toBeHidden();
  const inspect = window.getByRole('button', { name: 'Inspect selected element' });
  await expect(inspect).toBeEnabled();
  await inspect.click();
  await expect(inspector).toBeVisible();
  await expect(inspect).toBeFocused();
  await expect(inspector.getByLabel('Text', { exact: true })).toHaveValue(text.content.text);
  await window.getByRole('button', { name: /^Show the chat/ }).click();
  await expect(request).toHaveValue(draft);
  await expect(request).toBeFocused();
  await expect(inspector).toBeHidden();
  await stage().click({ position: { x: 5, y: 5 } });
  await expect(existing).toHaveAttribute('aria-pressed', 'false');
  await expect(inspect).toBeDisabled();
  await existing.focus();
  await existing.press(' ');
  await expect(existing).toHaveAttribute('aria-pressed', 'true');
  await inspect.focus();
  await inspect.press('Enter');
  await expect(inspector).toBeVisible();
  await expect(inspect).toBeFocused();
  await window.getByLabel('Element to add').selectOption('rectangle');
  await window.getByRole('button', { name: 'Add rectangle', exact: true }).click();
  await expect(stage().locator('[data-element-id]')).toHaveCount(2);
  await expect(
    window.getByRole('region', { name: 'Transition 1 to 2. Out of date.' }),
  ).toBeVisible();
  await expect(window.getByRole('button', { name: 'Add image', exact: true })).toBeEnabled();
  await expect(window.getByRole('group', { name: 'Transition preview' })).toBeVisible();
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('All changes saved')).toBeVisible();
  const authored = komaProjectSchema.parse(JSON.parse(await readFile(source, 'utf8')));
  expect(authored.presentation.transitions).toEqual(project.presentation.transitions);
  await window.screenshot({ path: test.info().outputPath('narrow-inspector.png'), scale: 'css' });
  await window.getByRole('tab', { name: /^Motion/ }).click();
  await inspector.getByRole('button', { name: 'Recalculate motion', exact: true }).click();
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('All changes saved')).toBeVisible();
  const repaired = komaProjectSchema.parse(JSON.parse(await readFile(source, 'utf8')));
  expect(repaired.presentation.transitions).not.toEqual(project.presentation.transitions);
  await window.getByLabel('Position in the transition').fill('500');
  await expect(window.getByRole('button', { name: 'Add rectangle', exact: true })).toBeDisabled();
  await expect(inspect).toBeDisabled();
  await window.getByRole('button', { name: 'Stop preview', exact: true }).click();
  await expect(window.getByRole('button', { name: 'Add rectangle', exact: true })).toBeEnabled();
  await window.getByRole('button', { name: /^Show the chat/ }).click();
  await expect(request).toHaveValue(draft);
  expect(running.problems).toEqual([]);
});
