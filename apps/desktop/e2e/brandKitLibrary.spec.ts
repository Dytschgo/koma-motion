import { createDefaultBrandKit } from '@koma-motion/brand-kit';
import { createProject, createSeededIdGenerator } from '@koma-motion/core';
import { serialiseProject } from '@koma-motion/project-format';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  answerOpenDialog,
  answerSaveDialog,
  launchApplication,
  type RunningApplication,
} from './application';

const ONE_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let running: RunningApplication;

test.beforeEach(async () => {
  running = await launchApplication();
});

test.afterEach(async () => {
  await running.close();
});

function libraryDirectory(): string {
  return join(running.directory, 'user-data', 'brand-kits');
}

/** A second project with its own Brand Kit and no logo, written as a real `.koma` file. */
function harbourProjectText(): string {
  const base = createDefaultBrandKit();
  const project = createProject({
    idGenerator: createSeededIdGenerator('harbour-library'),
    name: 'Harbour project',
    now: '2026-09-30T12:00:00.000Z',
    brandKit: { ...base, name: 'Harbour Studio', colours: { ...base.colours, primary: '#112233' } },
  });
  const serialised = serialiseProject(project);
  if (!serialised.ok) {
    throw new Error(serialised.error.message);
  }
  return serialised.value;
}

async function openLibrary(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Brand Kit', exact: true });
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
    await toggle.click();
  }
  await page.getByRole('tab', { name: /Library/ }).click();
}

/** Selects a saved kit. Clicking a selected kit would close its actions. */
async function selectKit(page: Page, name: string): Promise<void> {
  const kit = page.getByRole('button', { name, exact: true });
  if ((await kit.getAttribute('aria-pressed')) !== 'true') {
    await kit.click();
  }
  await expect(kit).toHaveAttribute('aria-pressed', 'true');
}

async function dismissNotices(page: Page): Promise<void> {
  const buttons = page.getByRole('list', { name: 'Messages' }).getByRole('button', {
    name: 'Dismiss',
  });
  while ((await buttons.count()) > 0) {
    await buttons.first().click();
  }
}

test('saves a Brand Kit with its logo and applies it to another project', async () => {
  const { window, application, directory, problems } = running;
  const logoPath = join(directory, 'acme-logo.png');
  const harbourPath = join(directory, 'harbour.koma');
  await writeFile(logoPath, Buffer.from(ONE_PIXEL, 'base64'));
  const harbour = harbourProjectText();
  await writeFile(harbourPath, harbour, 'utf8');

  await test.step('build a Brand Kit with a logo in a first project', async () => {
    await window.getByRole('button', { name: 'Create a project' }).click();
    await window.getByRole('button', { name: 'Brand Kit', exact: true }).click();
    const name = window.getByLabel('Brand name');
    await name.fill('Acme Corp');
    await name.blur();
    await window.getByLabel('Tone').fill('Calm and precise');
    await answerOpenDialog(application, logoPath);
    await window.getByRole('button', { name: 'Choose a logo' }).click();
    await expect(window.getByText('acme-logo.png')).toBeVisible();
    // The canvas stays in place while the Brand Kit is open.
    await expect(window.getByRole('region', { name: 'Canvas' })).toBeVisible();
  });

  await test.step('save it to the empty library', async () => {
    await openLibrary(window);
    await expect(window.getByText('No saved Brand Kits yet')).toBeVisible();
    await window.getByRole('button', { name: 'Save current as new kit' }).click();
    const kit = window.getByRole('button', { name: 'Acme Corp', exact: true });
    await expect(kit).toBeVisible();
    await expect(kit).toHaveAttribute('aria-pressed', 'true');
    await expect(window.getByText('Logo: acme-logo.png')).toBeVisible();
    await expect(window.getByText('In use')).toBeVisible();
    await dismissNotices(window);

    const stored = await readFile(join(libraryDirectory(), 'library.json'), 'utf8');
    expect(stored).toContain('Calm and precise');
    expect(stored).not.toContain(directory);
    expect(stored).not.toContain(JSON.stringify(directory).slice(1, -1));
    // The image is a separate file in the library, named by its content.
    expect(stored).not.toContain(ONE_PIXEL);
    expect(await readdir(join(libraryDirectory(), 'logos'))).toHaveLength(1);
  });

  await test.step('replace the project and apply the saved kit there', async () => {
    await answerOpenDialog(application, harbourPath);
    await window.getByRole('button', { name: 'Open', exact: true }).click();
    await window.getByRole('button', { name: 'Discard changes' }).click();
    await expect(window.getByLabel('Project name')).toHaveValue('Harbour project');

    await openLibrary(window);
    await expect(window.getByText('In use')).toHaveCount(0);
    await selectKit(window, 'Acme Corp');
    await window.getByRole('button', { name: 'Apply to this project' }).click();
    await expect(window.getByText('Unsaved changes')).toBeVisible();
    await expect(window.getByText('In use')).toBeVisible();

    await window.getByRole('tab', { name: 'This project' }).click();
    await expect(window.getByLabel('Brand name')).toHaveValue('Acme Corp');
    await expect(window.getByLabel('Tone')).toHaveValue('Calm and precise');
    await expect(
      window.getByRole('img', { name: 'Preview of the Brand Kit' }).locator('img'),
    ).toHaveAttribute('src', `data:image/png;base64,${ONE_PIXEL}`);
    await expect(window.getByText(/Matches "Acme Corp" in your library/)).toBeVisible();
  });

  await test.step('undo and redo the switch', async () => {
    await window.getByRole('button', { name: 'Undo' }).click();
    await expect(window.getByLabel('Brand name')).toHaveValue('Harbour Studio');
    await expect(window.getByLabel('Primary colour')).toHaveValue('#112233');
    await expect(
      window.getByRole('img', { name: 'Preview of the Brand Kit' }).locator('img'),
    ).toHaveCount(0);
    await window.getByRole('button', { name: 'Redo' }).click();
    await expect(window.getByLabel('Brand name')).toHaveValue('Acme Corp');
  });

  await test.step('save the project with its own copy of the logo', async () => {
    const savedPath = join(directory, 'harbour-acme.koma');
    await answerSaveDialog(application, savedPath);
    await window.getByRole('button', { name: 'Save as' }).click();
    await expect(window.getByText('All changes saved')).toBeVisible();
    const text = await readFile(savedPath, 'utf8');
    expect(text).toContain(ONE_PIXEL);
    expect(text).toContain('Calm and precise');
    expect(text).not.toContain(directory);
    expect(text).not.toContain('brand-kits');
    expect(await readFile(harbourPath, 'utf8')).toBe(harbour);
  });

  expect(problems).toEqual([]);
});

test('renames, duplicates and deletes saved kits without touching the project', async () => {
  const { window, problems } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await openLibrary(window);

  await window.getByRole('button', { name: 'New blank kit' }).click();
  await expect(window.getByRole('button', { name: 'New Brand Kit', exact: true })).toBeVisible();
  await expect(window.getByText('Unsaved changes')).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'Undo' })).toBeDisabled();

  await window.getByRole('button', { name: 'Rename' }).click();
  const newName = window.getByLabel('New name');
  await newName.fill('   ');
  await expect(window.getByText('A saved Brand Kit needs a name.')).toBeVisible();
  await expect(window.getByRole('button', { name: 'Save name' })).toBeDisabled();
  await newName.fill('Night blue');
  await newName.press('Enter');
  await expect(window.getByRole('button', { name: 'Night blue', exact: true })).toBeVisible();

  await window.getByRole('button', { name: 'Duplicate' }).click();
  const copy = window.getByRole('button', { name: 'Night blue copy', exact: true });
  await expect(copy).toHaveAttribute('aria-pressed', 'true');
  await expect(
    window.getByRole('list', { name: 'Saved Brand Kits' }).getByRole('listitem'),
  ).toHaveCount(2);

  await window.getByRole('button', { name: 'Delete' }).click();
  await expect(window.getByRole('dialog', { name: 'Delete "Night blue copy"?' })).toBeVisible();
  await window.getByRole('button', { name: 'Keep it' }).click();
  await expect(copy).toBeVisible();

  await window.getByRole('button', { name: 'Delete' }).click();
  await window.getByRole('button', { name: 'Delete saved kit' }).click();
  await expect(copy).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'Night blue', exact: true })).toBeVisible();

  // Library changes are not project changes.
  await expect(window.getByText('Unsaved changes')).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'Undo' })).toBeDisabled();
  const stored = await readFile(join(libraryDirectory(), 'library.json'), 'utf8');
  expect(stored).toContain('Night blue');
  expect(stored).not.toContain('Night blue copy');
  expect(problems).toEqual([]);
});

test('reports a damaged library and keeps it as a backup when starting again', async () => {
  const { window } = running;
  await mkdir(libraryDirectory(), { recursive: true });
  const damaged = '{ "format": "koma-motion/brand-kit-library", "kits": [ {';
  await writeFile(join(libraryDirectory(), 'library.json'), damaged, 'utf8');

  await window.getByRole('button', { name: 'Create a project' }).click();
  await openLibrary(window);
  const panel = window.getByRole('complementary', { name: 'Brand Kit' });
  await expect(panel.getByRole('alert')).toContainText('could not be read');
  await expect(window.getByRole('button', { name: 'Save current as new kit' })).toHaveCount(0);
  expect(await readFile(join(libraryDirectory(), 'library.json'), 'utf8')).toBe(damaged);

  // The project Brand Kit still works.
  await window.getByRole('tab', { name: 'This project' }).click();
  await expect(window.getByLabel('Brand name')).toBeEditable();
  await window.getByRole('tab', { name: /Library/ }).click();

  await window.getByRole('button', { name: 'Keep a backup and start a new library' }).click();
  await window.getByRole('button', { name: 'Keep backup and start new' }).click();
  await expect(window.getByText('No saved Brand Kits yet')).toBeVisible();
  const files = await readdir(libraryDirectory());
  const backup = files.find((file) => file.startsWith('library.unreadable-'));
  expect(backup).toBeDefined();
  expect(await readFile(join(libraryDirectory(), backup ?? ''), 'utf8')).toBe(damaged);
});

test('keeps the canvas controls usable beside the Brand Kit at the minimum width', async () => {
  const { window, application } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 700);
  });
  await window.getByRole('button', { name: 'Create a project' }).click();
  await window.getByRole('button', { name: 'Use the example request' }).click();
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();

  await window.getByRole('button', { name: 'Brand Kit', exact: true }).click();
  const panel = window.getByRole('complementary', { name: 'Brand Kit' });
  await expect(panel.getByLabel('Brand name')).toBeVisible();
  const page = await window.locator('body').boundingBox();
  const panelBox = await panel.boundingBox();
  expect(panelBox?.width ?? 0).toBeGreaterThanOrEqual(360);
  expect((panelBox?.x ?? 0) + (panelBox?.width ?? 0)).toBeLessThanOrEqual((page?.width ?? 0) + 1);

  const slider = window.getByLabel('Position in the transition');
  await expect(slider).toBeVisible();
  expect((await slider.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(96);
  await expect(window.getByRole('button', { name: 'Play' })).toBeEnabled();
  await expect(window.getByLabel('Transition duration in seconds')).toBeVisible();
  await slider.fill('500');
  await expect(slider).toHaveAttribute('aria-valuetext', '50 percent');

  // Choosing another Koma keeps the Brand Kit open; closing it brings the inspector back.
  await window.getByRole('button', { name: /^Koma 2:/ }).click();
  await expect(panel).toBeVisible();
  await window.getByRole('button', { name: 'Close panel' }).click();
  await expect(panel).toHaveCount(0);
  await expect(window.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
});
