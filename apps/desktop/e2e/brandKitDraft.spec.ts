import { createDefaultBrandKit } from '@koma-motion/brand-kit';
import { createProject, createSeededIdGenerator } from '@koma-motion/core';
import { serialiseProject } from '@koma-motion/project-format';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { answerOpenDialog, launchApplication, type RunningApplication } from './application';

let running: RunningApplication;

test.beforeEach(async () => {
  running = await launchApplication();
});

test.afterEach(async () => {
  await running.close();
});

/**
 * A second project with its own Brand Kit, written with the same factories
 * and serialiser the application uses, so the file is a real `.koma` document.
 */
function harbourProjectText(): string {
  const base = createDefaultBrandKit();
  const project = createProject({
    idGenerator: createSeededIdGenerator('harbour'),
    name: 'Harbour project',
    now: '2026-09-29T12:00:00.000Z',
    brandKit: {
      ...base,
      name: 'Harbour Studio',
      colours: { ...base.colours, primary: '#112233', secondary: '#445566' },
    },
  });
  const serialised = serialiseProject(project);
  if (!serialised.ok) {
    throw new Error(serialised.error.message);
  }
  return serialised.value;
}

async function openBrandKit(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Create a project' }).click();
  await expect(page.getByLabel('Project name')).toHaveValue('Untitled project');
  await page.getByRole('button', { name: 'Brand Kit' }).click();
  await expect(page.getByLabel('Brand name')).toBeVisible();
}

/** Replaces the field one character at a time. `fill()` would hide the space bug. */
async function typeOver(field: Locator, text: string): Promise<void> {
  await field.click();
  await field.press('ControlOrMeta+A');
  await field.pressSequentially(text, { delay: 15 });
}

test('keeps spaces in the brand name and heading font while typing', async () => {
  const { window } = running;
  await openBrandKit(window);

  const name = window.getByLabel('Brand name');
  await name.click();
  await name.press('ControlOrMeta+A');
  await name.pressSequentially('Acme', { delay: 15 });
  await name.pressSequentially(' ', { delay: 15 });
  await expect(name).toHaveValue('Acme ');
  await name.pressSequentially('Corp', { delay: 15 });
  await expect(name).toHaveValue('Acme Corp');
  await name.blur();
  await expect(name).toHaveValue('Acme Corp');

  const heading = window.getByLabel('Heading font');
  await heading.click();
  await heading.press('ControlOrMeta+A');
  await heading.pressSequentially('Times', { delay: 15 });
  await heading.pressSequentially(' ', { delay: 15 });
  await expect(heading).toHaveValue('Times ');
  await heading.pressSequentially('New Roman', { delay: 15 });
  await expect(heading).toHaveValue('Times New Roman');
});

test('keeps an invalid colour without dropping the other Brand Kit edits', async () => {
  const { window } = running;
  await openBrandKit(window);

  const primary = window.getByLabel('Primary colour');
  await typeOver(primary, 'nope');
  await expect(window.getByText(/"nope" is not a valid hex colour/)).toBeVisible();

  const name = window.getByLabel('Brand name');
  await typeOver(name, 'Acme Corp');
  await expect(name).toHaveValue('Acme Corp');

  const body = window.getByLabel('Body font');
  await typeOver(body, 'Times New Roman');
  await expect(body).toHaveValue('Times New Roman');

  const topics = window.getByLabel('Preferred topics');
  await topics.click();
  await topics.pressSequentially('motion, design', { delay: 15 });
  await topics.blur();

  await expect(window.getByText(/"nope" is not a valid hex colour/)).toBeVisible();
  await expect(topics).toHaveValue('motion, design');
  await expect(name).toHaveValue('Acme Corp');
  await expect(body).toHaveValue('Times New Roman');
  await expect(window.getByRole('img', { name: 'Preview of the Brand Kit' })).toContainText(
    'Acme Corp',
  );

  await window.getByRole('button', { name: 'Back to the canvas' }).click();
  await expect(window.getByRole('region', { name: 'Canvas' })).toBeVisible();
  await window.getByRole('button', { name: 'Brand Kit' }).click();

  await expect(window.getByLabel('Primary colour')).toHaveValue('nope');
  await expect(window.getByLabel('Brand name')).toHaveValue('Acme Corp');
  await expect(window.getByLabel('Body font')).toHaveValue('Times New Roman');
  await expect(window.getByLabel('Preferred topics')).toHaveValue('motion, design');
  await expect(window.getByText(/"nope" is not a valid hex colour/)).toBeVisible();
  await expect(window.getByRole('img', { name: 'Preview of the Brand Kit' })).toContainText(
    'Acme Corp',
  );
  await expect(window.getByText(/last valid Brand Kit/)).toBeVisible();
});

test('undoes and redoes a blurred brand name', async () => {
  const { window } = running;
  await openBrandKit(window);

  const name = window.getByLabel('Brand name');
  await expect(name).toHaveValue('Untitled brand');
  await typeOver(name, 'Acme Corp');
  await name.blur();
  await expect(name).toHaveValue('Acme Corp');

  await window.getByRole('button', { name: 'Undo' }).click();
  await expect(name).toHaveValue('Untitled brand');
  await window.getByRole('button', { name: 'Redo' }).click();
  await expect(name).toHaveValue('Acme Corp');
});

test('does not apply a Brand Kit draft to another project', async () => {
  const { window, application, directory } = running;
  const filePath = join(directory, 'harbour.koma');
  const document = harbourProjectText();
  await writeFile(filePath, document, 'utf8');

  await openBrandKit(window);
  await typeOver(window.getByLabel('Brand name'), 'Acme Corp');
  await window.getByLabel('Brand name').blur();
  await typeOver(window.getByLabel('Primary colour'), 'nope');
  await expect(window.getByText(/"nope" is not a valid hex colour/)).toBeVisible();
  await expect(window.getByText('Unsaved changes')).toBeVisible();

  await answerOpenDialog(application, filePath);
  await window.getByRole('button', { name: 'Open', exact: true }).click();
  await window.getByRole('button', { name: 'Discard changes' }).click();

  await expect(window.getByLabel('Project name')).toHaveValue('Harbour project');
  await window.getByRole('button', { name: 'Brand Kit' }).click();
  await expect(window.getByLabel('Brand name')).toHaveValue('Harbour Studio');
  await expect(window.getByLabel('Primary colour')).toHaveValue('#112233');
  await expect(window.getByLabel('Secondary colour')).toHaveValue('#445566');
  await expect(window.getByText(/not a valid hex colour/)).toHaveCount(0);

  const saved = await readFile(filePath, 'utf8');
  expect(saved).toBe(document);
  expect(saved).not.toContain('nope');
  expect(saved).not.toContain('Acme Corp');
});
