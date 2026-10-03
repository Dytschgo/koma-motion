import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { komaProjectSchema, type ImageElement } from '@koma-motion/core';
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

let running: RunningApplication | undefined;
let directory: string;
test.beforeEach(async () => {
  running = await launchApplication({ preserveDirectory: true });
  directory = running.directory;
});
test.afterEach(async () => {
  await running?.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 5 });
});
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';

function fixture() {
  const image: ImageElement = {
    ...buildShape(),
    id: 'image-1',
    persistentId: 'photo',
    type: 'image',
    name: 'Saved image',
    content: { assetId: 'image-asset', altText: 'Recovered image' },
    style: { fit: 'contain', cornerRadius: 0 },
  };
  const komas = [
    buildKoma({ id: 'koma-1', title: 'Original title', elements: [image], holdDurationMs: 2500 }),
    buildKoma({ id: 'koma-2', title: 'Second frame' }),
  ];
  const transition = buildTransition({ id: 'motion', from: komas[0]!, to: komas[1]! });
  if (!transition.ok) throw new Error('Invalid test transition');
  return buildProject({
    name: 'Interrupted deck',
    presentation: buildPresentation({ komas, transitions: [transition.value.transition] }),
    assets: [
      {
        id: 'image-asset',
        type: 'image',
        name: 'photo.png',
        projectPath: 'assets/photo.png',
        mediaType: 'image/png',
        embeddedData: { encoding: 'base64', data: PNG },
        metadata: {},
      },
    ],
  });
}

async function openAndEdit() {
  if (!running) throw new Error('Application not running');
  const source = join(directory, 'original.koma');
  const original = JSON.stringify(fixture());
  await writeFile(source, original);
  await answerOpenDialog(running.application, source);
  await running.window.getByRole('button', { name: 'Open', exact: true }).click();
  await showInspector(running.window);
  await running.window.getByRole('tab', { name: 'Koma', exact: true }).click();
  await running.window
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Recovered committed title');
  await expect(running.window.getByText('Recovery snapshot saved', { exact: true })).toBeVisible();
  return { source, original };
}

async function restart(crash: boolean) {
  if (!running) throw new Error('Application not running');
  if (crash) {
    const process = running.application.process();
    await new Promise<void>((resolve, reject) => {
      process.once('exit', () => resolve());
      process.once('error', reject);
      if (!process.kill('SIGKILL')) reject(new Error('Could not terminate this test instance'));
    });
  } else await running.close();
  running = undefined;
  running = await launchApplication({ directory, preserveDirectory: true });
  return running;
}

test('forced termination offers committed edits, images and holds as an unsaved protected copy', async () => {
  const testInfo = test.info();
  const { source, original } = await openAndEdit();
  let app = await restart(true);
  const offer = app.window.getByRole('dialog', { name: 'Recover interrupted work' });
  await expect(offer).toContainText('Interrupted deck');
  // Closing an unresolved offer preserves it for the next start.
  app = await restart(false);
  const recover = app.window.getByRole('button', { name: 'Recover unsaved copy' });
  await recover.focus();
  await app.window.keyboard.press('Enter');
  await expect(
    app.window.getByRole('dialog', { name: 'Recover interrupted work' }),
  ).not.toBeVisible();
  await expect(app.window.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await showInspector(app.window);
  await app.window.getByRole('tab', { name: 'Koma', exact: true }).click();
  await expect(app.window.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
    'Recovered committed title',
  );
  await expect(app.window.getByLabel('Koma hold duration in seconds')).toHaveValue('2.5');
  await expect(
    app.window.getByRole('img', { name: 'Recovered image', exact: true }).first(),
  ).toBeVisible();
  await app.window.screenshot({ path: testInfo.outputPath('recovered-copy.png') });
  await answerSaveDialog(app.application, source);
  await app.window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    app.window.getByRole('alert').filter({ hasText: 'Choose a different name' }),
  ).toBeVisible();
  expect(await readFile(source, 'utf8')).toBe(original);
  const copy = join(directory, 'recovered-copy.koma');
  await answerSaveDialog(app.application, copy);
  await app.window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(app.window.getByText('All changes saved', { exact: true })).toBeVisible();
  const saved = komaProjectSchema.parse(JSON.parse(await readFile(copy, 'utf8')));
  expect(saved.presentation.komas[0]?.title).toBe('Recovered committed title');
  expect(saved.presentation.komas[0]?.holdDurationMs).toBe(2500);
  expect(saved.assets).toEqual(fixture().assets);
  expect(await readFile(source, 'utf8')).toBe(original);
  await app.window.keyboard.press('F5');
  await expect(app.window.getByRole('dialog', { name: 'Presentation', exact: true })).toBeVisible();
  await app.window.keyboard.press('Escape');
  app = await restart(false);
  await expect(
    app.window.getByRole('dialog', { name: 'Recover interrupted work' }),
  ).not.toBeVisible();
  await answerOpenDialog(app.application, copy);
  await app.window.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(app.window.getByRole('list', { name: 'Komas' })).toContainText(
    'Recovered committed title',
  );
  expect(app.problems).toEqual([]);
});

test('normal explicit discard removes unsaved recovery', async () => {
  await openAndEdit();
  const app = await restart(false);
  await expect(
    app.window.getByRole('dialog', { name: 'Recover interrupted work' }),
  ).not.toBeVisible();
  await expect(
    app.window.getByRole('button', { name: 'Create a project', exact: true }).first(),
  ).toBeVisible();
});

test('damaged recovery is retained until keyboard-accessible explicit discard', async () => {
  await running?.close();
  const snapshot = join(directory, 'user-data', 'recovery', 'snapshot.json');
  await mkdir(join(directory, 'user-data', 'recovery'), { recursive: true });
  await writeFile(snapshot, 'damaged snapshot');
  running = await launchApplication({ directory, preserveDirectory: true });
  await expect(
    running.window.getByRole('dialog', { name: 'Recover interrupted work' }),
  ).toContainText('could not be read');
  expect(await readFile(snapshot, 'utf8')).toBe('damaged snapshot');
  const discard = running.window.getByRole('button', { name: 'Discard recovery' });
  await discard.focus();
  await running.window.keyboard.press('Enter');
  await expect(
    running.window.getByRole('dialog', { name: 'Recover interrupted work' }),
  ).not.toBeVisible();
  await expect(readFile(snapshot)).rejects.toThrow();
});

test('snapshot failure keeps the previous document and Retry persists the latest edit', async () => {
  await openAndEdit();
  if (!running) throw new Error('Application not running');
  const temporary = join(directory, 'user-data', 'recovery', 'snapshot.tmp');
  const snapshot = join(directory, 'user-data', 'recovery', 'snapshot.json');
  const previous = await readFile(snapshot, 'utf8');
  await mkdir(temporary);
  await running.window
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Edit after disk failure');
  await expect(
    running.window.getByRole('button', { name: 'Retry recovery snapshot' }),
  ).toBeVisible();
  expect(await readFile(snapshot, 'utf8')).toBe(previous);
  await rm(temporary, { recursive: true });
  await running.window.getByRole('button', { name: 'Retry recovery snapshot' }).click();
  await expect(running.window.getByText('Recovery snapshot saved', { exact: true })).toBeVisible();
  expect(await readFile(snapshot, 'utf8')).toContain('Edit after disk failure');
});
