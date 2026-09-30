import { MAX_SYSTEM_INSTRUCTIONS_LENGTH } from '@koma-motion/core';
import { mkdir, readFile, rm } from 'node:fs/promises';
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

test('creates an app template before opening a project and keeps controls usable at a narrow width', async () => {
  const { window, application } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 800);
  });
  await window.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    window.getByText('Create or open a project to edit its instructions or apply a template.'),
  ).toBeVisible();
  await window.getByLabel('New template name').fill('First template');
  await window.getByLabel('New template instructions').fill('Use clear language.');
  const save = window.getByRole('button', { name: 'Save new template' });
  await save.focus();
  await window.keyboard.press('Enter');
  await expect(
    window.getByRole('status').filter({ hasText: 'Template library saved' }),
  ).toBeVisible();
  await window.getByRole('button', { name: 'Done', exact: true }).click();
  await window.getByRole('button', { name: 'Create a project' }).click();
  const shortcut = window.getByRole('button', { name: 'Instructions & templates' });
  await expect(shortcut).toBeInViewport({ ratio: 1 });
  await expect(window.getByLabel('Your request')).toBeInViewport({ ratio: 1 });
  await shortcut.click();
  await window.getByLabel('Saved instruction template').selectOption({ label: 'First template' });
  await window.getByRole('button', { name: 'Apply to project' }).click();
  await expect(window.getByLabel('Project system instructions')).toHaveValue('Use clear language.');
  expect(running.problems).toEqual([]);
});

test('saves project instructions and reuses app templates with undo and redo', async () => {
  const testInfo = test.info();
  const { window, application, directory } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await window.getByRole('button', { name: 'Instructions & templates' }).click();
  await expect(
    window.getByText('No saved templates yet. Save your first template below.'),
  ).toBeVisible();
  const field = window.getByLabel('Project system instructions');
  await expect(field).toHaveValue('');
  const instructions = '  Use concise language.\nExplain technical terms. 日本語  ';
  await field.fill(instructions);
  await window.getByRole('button', { name: 'Copy project text into template draft' }).click();
  await window.getByLabel('New template name').fill('Technical');
  await window.getByRole('button', { name: 'Save new template' }).click();
  await expect(
    window.getByRole('status').filter({ hasText: 'Template library saved' }),
  ).toBeVisible();
  await window.getByRole('button', { name: 'Done', exact: true }).click();
  const path = join(directory, 'source.koma');
  await answerSaveDialog(application, path);
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('Saved source.koma', { exact: true })).toBeVisible();
  const source: unknown = JSON.parse(await readFile(path, 'utf8'));
  expect(source).toHaveProperty('systemInstructions', instructions);
  expect(JSON.stringify(source)).not.toContain('Technical');
  expect(source).not.toHaveProperty('templates');

  await window.getByRole('button', { name: 'Instructions & templates' }).click();
  const select = window.getByLabel('Saved instruction template');
  await select.selectOption({ label: 'Technical' });
  await window.getByLabel('Template name', { exact: true }).fill('Copy');
  await window.getByRole('button', { name: 'Duplicate template' }).click();
  await expect(select.locator('option')).toHaveCount(3);
  await select.selectOption({ label: 'Copy' });
  await window.getByLabel('Template name', { exact: true }).fill('Plain language');
  await window.getByRole('button', { name: 'Rename template' }).click();
  await expect(select.locator('option').filter({ hasText: 'Plain language' })).toHaveCount(1);
  await select.selectOption({ label: 'Technical' });
  await window.getByRole('button', { name: 'Delete template' }).click();
  await expect(select.locator('option')).toHaveCount(2);
  await window.getByRole('button', { name: 'Done', exact: true }).click();
  // App CRUD has not dirtied the saved project.
  await expect(window.getByText('Unsaved changes', { exact: true })).toHaveCount(0);

  await window.getByRole('button', { name: 'New', exact: true }).click();
  await window.getByRole('button', { name: 'Instructions & templates' }).click();
  await expect(field).toHaveValue('');
  await select.selectOption({ label: 'Plain language' });
  await window.getByRole('button', { name: 'Apply to project' }).click();
  await expect(field).toHaveValue(instructions);
  await window.screenshot({ path: testInfo.outputPath('instructions-and-templates.png') });
  await window.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(window.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(window.getByText('No project instructions', { exact: true })).toBeVisible();
  await expect(window.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  await window.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(window.getByText('Project instructions active', { exact: true })).toBeVisible();
  const second = join(directory, 'applied.koma');
  await answerSaveDialog(application, second);
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('Saved applied.koma', { exact: true })).toBeVisible();
  await window.getByRole('button', { name: 'New', exact: true }).click();
  await answerOpenDialog(application, second);
  await window.getByRole('button', { name: 'Open', exact: true }).click();
  await window.getByRole('button', { name: 'Instructions & templates' }).click();
  await expect(field).toHaveValue(instructions);
  await expect(
    window.getByText(
      'Template applied to this project. Save the project to keep it. You can undo this change.',
      { exact: true },
    ),
  ).toHaveCount(0);
  await select.selectOption({ label: 'Plain language' });
  await expect(window.getByLabel('Saved template instructions')).toHaveValue(instructions);
  expect(running.problems).toEqual([]);
});

test('retains invalid drafts and failed template and project saves', async () => {
  const testInfo = test.info();
  const { window, application, directory } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await window.getByRole('button', { name: 'Instructions & templates' }).click();
  const field = window.getByLabel('Project system instructions');
  await field.fill('Last valid instructions');
  const overlong = 'x'.repeat(MAX_SYSTEM_INSTRUCTIONS_LENGTH + 1);
  await field.fill(overlong);
  await expect(field).toHaveValue(overlong);
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await field.blur();
  await window.getByRole('button', { name: 'Done', exact: true }).click();
  await window.getByRole('button', { name: 'Instructions & templates' }).click();
  await expect(field).toHaveValue(overlong);
  await field.fill('Last valid instructions');
  await window.getByLabel('New template name').fill('My template');
  await window.getByLabel('New template instructions').fill(overlong);
  await expect(window.getByRole('button', { name: 'Save new template' })).toBeDisabled();
  await expect(window.getByLabel('New template instructions')).toHaveValue(overlong);
  await window.getByLabel('New template instructions').fill('Keep this template draft');
  const userData = await application.evaluate(({ app }) => app.getPath('userData'));
  const templatePath = join(userData, 'instruction-templates.json');
  await mkdir(templatePath);
  await window.getByRole('button', { name: 'Save new template' }).click();
  await expect(window.getByText(/The template could not be saved/)).toBeVisible();
  await window.screenshot({ path: testInfo.outputPath('template-save-failure.png') });
  await window.getByRole('button', { name: 'Done', exact: true }).click();
  await window.getByRole('button', { name: 'Instructions & templates' }).click();
  await expect(window.getByLabel('New template name')).toHaveValue('My template');
  await expect(window.getByLabel('New template instructions')).toHaveValue(
    'Keep this template draft',
  );
  await rm(templatePath, { recursive: true });
  await window.getByRole('button', { name: 'Reload templates' }).click();
  await window.getByRole('button', { name: 'Save new template' }).click();
  await expect(
    window.getByRole('status').filter({ hasText: 'Template library saved' }),
  ).toBeVisible();
  await window.getByRole('button', { name: 'Done', exact: true }).click();

  await answerSaveDialog(application, join(directory, 'missing-folder', 'failed.koma'));
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText(/could not be saved|could not be written/i)).toBeVisible();
  await expect(window.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await window.getByRole('button', { name: 'Instructions & templates' }).click();
  await expect(field).toHaveValue('Last valid instructions');
  expect(running.problems).toEqual([]);
});
