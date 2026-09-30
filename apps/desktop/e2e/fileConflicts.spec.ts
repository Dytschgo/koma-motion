import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildProject } from '@koma-motion/core/testing';
import { expect, test } from '@playwright/test';
import { answerOpenDialog, answerSaveDialog, launchApplication } from './application';

test('keeps external changes and saves local edits to a separate copy', async () => {
  const running = await launchApplication();
  const { window, application, directory } = running;
  try {
    const filePath = join(directory, 'shared.koma');
    const copyPath = join(directory, 'my-copy.koma');
    await writeFile(filePath, JSON.stringify(buildProject({ name: 'Original' })));
    await answerOpenDialog(application, filePath);
    await window.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(window.getByLabel('Project name')).toHaveValue('Original');
    await window.getByLabel('Project name').fill('My local edit');

    const external = JSON.stringify(buildProject({ name: 'Saved in another window' }));
    await writeFile(filePath, external);
    await window.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(window.getByRole('alert')).toContainText('changed or removed outside this window');
    await expect(window.getByLabel('Project name')).toHaveValue('My local edit');
    await expect(window.getByText('Unsaved changes', { exact: true })).toBeVisible();
    expect(await readFile(filePath, 'utf8')).toBe(external);
    await window.screenshot({ path: test.info().outputPath('file-conflict.png') });

    await answerSaveDialog(application, copyPath);
    await window.getByRole('button', { name: 'Save as', exact: true }).click();
    await expect(window.getByText('All changes saved', { exact: true })).toBeVisible();
    expect(JSON.parse(await readFile(copyPath, 'utf8'))).toMatchObject({ name: 'My local edit' });
    expect(await readFile(filePath, 'utf8')).toBe(external);

    // Advancing the baseline must allow the next normal save to this new path.
    await window.getByLabel('Project name').fill('My second edit');
    await window.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(window.getByText('All changes saved', { exact: true })).toBeVisible();
    expect(JSON.parse(await readFile(copyPath, 'utf8'))).toMatchObject({ name: 'My second edit' });
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});
