import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CURRENT_SCHEMA_VERSION,
  komaProjectSchema,
  type ImageElement,
  type KomaProject,
} from '@koma-motion/core';
import { buildKoma, buildPresentation, buildProject, buildShape } from '@koma-motion/core/testing';
import { expect, test } from '@playwright/test';
import {
  answerOpenDialog,
  answerSaveDialog,
  launchApplication,
  showInspector,
  showChat,
  type RunningApplication,
} from './application';

let running: RunningApplication;
test.beforeEach(async () => {
  running = await launchApplication();
});
test.afterEach(async () => {
  await running.close();
});
const health = () => running.window.getByRole('dialog', { name: 'Project health', exact: true });
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
  'base64',
);

function image(index: number): ImageElement {
  return {
    ...buildShape(),
    id: `image-${String(index)}`,
    persistentId: `photo-${String(index)}`,
    type: 'image',
    name: `Photo ${String(index)}`,
    content: { assetId: 'unavailable', altText: 'Keep alt text' },
    style: { fit: 'contain', cornerRadius: 0 },
  };
}
function fixture(count = 2, logo = false): KomaProject {
  const base = buildProject();
  return {
    ...base,
    name: 'Asset recovery',
    brandKit: { ...base.brandKit, logoAssetId: logo ? 'unavailable' : null },
    assets: [
      {
        id: 'unavailable',
        type: 'image',
        name: 'old.png',
        mediaType: 'image/png',
        projectPath: 'assets/old.png',
        metadata: {},
        embeddedData: null,
      },
    ],
    presentation: buildPresentation({
      komas: [
        buildKoma({ elements: Array.from({ length: count }, (_, index) => image(index + 1)) }),
      ],
    }),
  };
}
async function writeProject(name: string, project: unknown): Promise<string> {
  const path = join(running.directory, name);
  await writeFile(path, JSON.stringify(project));
  return path;
}
async function open(path: string, discard = false): Promise<void> {
  await answerOpenDialog(running.application, path);
  await running.window.getByRole('button', { name: 'Open', exact: true }).click();
  if (discard)
    await running.window
      .getByRole('dialog', { name: 'Discard unsaved changes?' })
      .getByRole('button', { name: 'Discard changes' })
      .click();
}
async function showHealth(): Promise<void> {
  await running.window.getByRole('button', { name: /^Project health/ }).click();
  await expect(health()).toBeVisible();
}

test('upgrades legacy projects as information, refuses copying onto the source, and saves current-format copies', async () => {
  const testInfo = test.info();
  const source = await writeProject('legacy.koma', { ...buildProject(), schemaVersion: 1 });
  const original = await readFile(source, 'utf8');
  await open(source);
  await expect(health()).toBeVisible();
  await expect(health().getByRole('region', { name: 'Information' })).toContainText(
    `to ${String(CURRENT_SCHEMA_VERSION)}`,
  );
  await expect(health()).toContainText('Saving writes the current format');
  await expect(health().getByRole('region', { name: 'Needs attention' })).toHaveCount(0);
  await expect(health()).not.toContainText('time limit');
  await expect(running.window.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await answerSaveDialog(running.application, source);
  await health().getByRole('button', { name: 'Save a copy', exact: true }).click();
  await expect(health()).toContainText('Save did not complete');
  expect(await readFile(source, 'utf8')).toBe(original);
  const copy = join(running.directory, 'current-copy.koma');
  await answerSaveDialog(running.application, copy);
  await health().getByRole('button', { name: 'Save a copy', exact: true }).click();
  await expect(health()).toContainText('Project saved in the current format');
  expect(komaProjectSchema.parse(JSON.parse(await readFile(copy, 'utf8'))).schemaVersion).toBe(
    CURRENT_SCHEMA_VERSION,
  );
  expect(await readFile(source, 'utf8')).toBe(original);
  await running.window.screenshot({ path: testInfo.outputPath('migration-saved.png') });
  await health().getByRole('button', { name: 'Close', exact: true }).click();
  await open(copy);
  await showHealth();
  await expect(health()).toContainText('No project issues found');
  expect(running.problems).toEqual([]);
});

test('failed migration preserves original bytes, the active document and draft; recovery can inspect and retry', async () => {
  const testInfo = test.info();
  await running.window.getByRole('button', { name: 'Create a project' }).click();
  await showInspector(running.window);
  await running.window.getByLabel('Project name', { exact: true }).fill('Keep my edits');
  await running.window.getByRole('button', { name: 'Brand Kit', exact: true }).click();
  await running.window.getByLabel('Primary colour', { exact: true }).fill('unfinished');
  const source = await writeProject('failed-migration.koma', {
    ...buildProject(),
    schemaVersion: 2,
    name: '',
  });
  const original = await readFile(source, 'utf8');
  await open(source, true);
  await expect(health()).toContainText('format upgrade failed');
  await expect(health()).toContainText('The original file was not changed');
  await health().getByText('Inspect diagnostics', { exact: true }).click();
  await expect(health()).toContainText('migrationFailed');
  await running.window.screenshot({ path: testInfo.outputPath('migration-recovery.png') });
  await answerOpenDialog(running.application, source);
  await health().getByRole('button', { name: 'Try opening again' }).click();
  await running.window
    .getByRole('dialog', { name: 'Discard unsaved changes?' })
    .getByRole('button', { name: 'Discard changes' })
    .click();
  await expect(health()).toContainText('format upgrade failed');
  expect(await readFile(source, 'utf8')).toBe(original);
  await health().getByRole('button', { name: 'Close', exact: true }).click();
  await expect(running.window.getByLabel('Primary colour', { exact: true })).toHaveValue(
    'unfinished',
  );
  await running.window.getByRole('button', { name: 'Brand Kit', exact: true }).click();
  await expect(running.window.getByLabel('Project name', { exact: true })).toHaveValue(
    'Keep my edits',
  );
  expect(running.problems).toEqual([]);
});

test('Save current format writes version 3; optional generation timing stays in controls', async () => {
  const source = await writeProject('legacy-v2.koma', { ...buildProject(), schemaVersion: 2 });
  await open(source);
  await expect(health()).toContainText('Project upgraded from format version 2');
  await health().getByRole('button', { name: 'Save current format' }).click();
  await expect(health()).toContainText('Project saved in the current format');
  expect(komaProjectSchema.parse(JSON.parse(await readFile(source, 'utf8'))).schemaVersion).toBe(
    CURRENT_SCHEMA_VERSION,
  );
  await health().getByRole('button', { name: 'Close', exact: true }).click();
  await showChat(running.window);
  await running.window.getByRole('button', { name: 'Generation settings', exact: true }).focus();
  await expect(
    running.window.getByText('No time limit. Cancel generation at any time.', { exact: false }),
  ).toBeVisible();
  await running.window.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = running.window.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByLabel('Stop generation after a time limit', { exact: true }).check();
  await settings.getByLabel('Time limit in seconds', { exact: true }).fill('45');
  await settings.getByRole('button', { name: 'Done' }).click();
  await running.window.getByRole('button', { name: 'Generation settings', exact: true }).focus();
  await expect(running.window.getByRole('tooltip')).toContainText('Stops after 45 seconds');
  await running.window.keyboard.press('Escape');
  await showHealth();
  await expect(health()).toContainText('No project issues found');
  expect(running.problems).toEqual([]);
});

test('missing image replacement reports failure inline, then fixes only its target with undo and persistence', async () => {
  const testInfo = test.info();
  const source = await writeProject('images.koma', fixture());
  const original = await readFile(source, 'utf8');
  await open(source);
  await showHealth();
  const row = health().getByRole('listitem').filter({ hasText: 'image "Photo 1"' });
  const invalid = join(running.directory, 'bad.png');
  await writeFile(invalid, 'not an image');
  await answerOpenDialog(running.application, invalid);
  await row.getByRole('button', { name: 'Replace image' }).click();
  await expect(row).toContainText('not a PNG');
  await expect(health().getByRole('listitem')).toHaveCount(2);
  expect(await readFile(source, 'utf8')).toBe(original);
  await running.window.screenshot({ path: testInfo.outputPath('repair-failure.png') });
  const replacement = join(running.directory, 'replacement.png');
  await writeFile(replacement, PNG);
  await answerOpenDialog(running.application, replacement);
  await row.getByRole('button', { name: 'Replace image' }).click();
  await expect(health()).toContainText('Image replaced');
  await expect(row).toHaveCount(0);
  await expect(health().getByRole('listitem')).toHaveCount(1);
  await health().getByRole('button', { name: 'Close', exact: true }).click();
  await running.window.getByRole('button', { name: 'Undo', exact: true }).click();
  await showHealth();
  await expect(health().getByRole('listitem')).toHaveCount(2);
  await health().getByRole('button', { name: 'Close', exact: true }).click();
  await running.window.getByRole('button', { name: 'Redo', exact: true }).click();
  await answerSaveDialog(running.application, join(running.directory, 'repaired.koma'));
  await running.window.getByRole('button', { name: 'Save as', exact: true }).click();
  await expect(running.window.getByText('All changes saved', { exact: true })).toBeVisible();
  const savedText = await readFile(join(running.directory, 'repaired.koma'), 'utf8');
  expect(savedText).not.toContain(running.directory);
  const saved = komaProjectSchema.parse(JSON.parse(savedText));
  const images = saved.presentation.komas[0]!.elements.filter(
    (element) => element.type === 'image',
  );
  expect(images[0]?.content.altText).toBe('Keep alt text');
  expect(images[1]?.content.assetId).toBe('unavailable');
  expect(saved.assets).toHaveLength(2);
  await open(join(running.directory, 'repaired.koma'));
  await showHealth();
  await expect(health().getByRole('listitem')).toHaveCount(1);
  await expect(row).toHaveCount(0);
  expect(await readFile(source, 'utf8')).toBe(original);
  expect(running.problems).toEqual([]);
});

test('logo replacement and confirmed clear are undoable and retain shared missing images', async () => {
  const source = await writeProject('logo.koma', fixture(1, true));
  await open(source);
  await showHealth();
  const logo = health().getByRole('listitem').filter({ hasText: 'Brand Kit logo image' });
  const replacement = join(running.directory, 'logo.png');
  await writeFile(replacement, PNG);
  await answerOpenDialog(running.application, replacement);
  await logo.getByRole('button', { name: 'Replace logo' }).click();
  await expect(logo).toHaveCount(0);
  await expect(health().getByRole('listitem')).toHaveCount(1);
  await health().getByRole('button', { name: 'Close', exact: true }).click();
  await running.window.getByRole('button', { name: 'Undo', exact: true }).click();
  await showHealth();
  await logo.getByRole('button', { name: 'Clear logo' }).click();
  const confirm = running.window.getByRole('dialog', { name: 'Clear logo?' });
  await confirm.getByRole('button', { name: 'Keep image' }).click();
  await expect(logo).toContainText('Repair cancelled');
  await logo.getByRole('button', { name: 'Clear logo' }).click();
  await confirm.getByRole('button', { name: 'Clear logo', exact: true }).click();
  await expect(logo).toHaveCount(0);
  await expect(health()).toContainText('Logo cleared');
  await expect(health().getByRole('listitem')).toHaveCount(1);
  await health().getByRole('button', { name: 'Close', exact: true }).click();
  await running.window.getByRole('button', { name: 'Undo', exact: true }).click();
  await showHealth();
  await expect(logo).toBeVisible();
  expect(running.problems).toEqual([]);
});

test('many warnings remain keyboard operable at a narrow size; hiding is distinct from fixing and reopening', async () => {
  const testInfo = test.info();
  await running.application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.setSize(960, 640);
  });
  await running.window.emulateMedia({ reducedMotion: 'reduce' });
  const source = await writeProject('many.koma', fixture(80));
  const original = await readFile(source, 'utf8');
  await open(source);
  const trigger = running.window.getByRole('button', { name: /^Project health/ });
  await trigger.focus();
  await trigger.press('Enter');
  await expect(health().getByRole('listitem')).toHaveCount(80);
  await running.window.screenshot({ path: testInfo.outputPath('many-warnings-overview.png') });
  const first = health().getByRole('listitem').first();
  await first.getByRole('button', { name: /^Hide notification:/ }).click();
  await expect(health().getByRole('listitem')).toHaveCount(79);
  await health().getByRole('button', { name: 'Show hidden notifications' }).click();
  await expect(health().getByRole('listitem')).toHaveCount(80);
  const last = health().getByRole('listitem').last().getByRole('button', { name: 'Replace image' });
  await last.focus();
  await expect(last).toBeInViewport();
  await last.press('Tab');
  expect(
    await running.window.evaluate(() =>
      document.activeElement?.closest('dialog')?.getAttribute('aria-labelledby'),
    ),
  ).toBeTruthy();
  const overflow = await health().evaluate((dialog) => dialog.scrollWidth > dialog.clientWidth);
  expect(overflow).toBe(false);
  await running.window.screenshot({ path: testInfo.outputPath('many-warnings-narrow.png') });
  await writeFile(
    testInfo.outputPath('window-facts.json'),
    JSON.stringify(
      {
        nativeBounds: await running.application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.getBounds(),
        ),
        viewport: await running.window.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        })),
      },
      null,
      2,
    ),
  );
  await first.getByRole('button', { name: /^Hide notification:/ }).click();
  await expect(health().getByRole('listitem')).toHaveCount(79);
  await health().press('Escape');
  await expect(health()).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await open(source);
  await showHealth();
  await expect(health().getByRole('listitem')).toHaveCount(80);
  expect(await readFile(source, 'utf8')).toBe(original);
  expect(running.problems).toEqual([]);
});
