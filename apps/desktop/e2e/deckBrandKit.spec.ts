import { z } from 'zod';
import { savedBrandKitSchema } from '@koma-motion/brand-kit';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { answerOpenDialog, answerSaveDialog, launchApplication } from './application';

for (const extension of ['pdf', 'pptx']) {
  test(`prepare ${extension}, review/edit, save without changing project, and explicitly apply`, async ({
    browserName: _browserName,
  }, testInfo) => {
    test.skip(
      extension === 'pptx' && !process.env['KOMA_LIBREOFFICE_EXECUTABLE'],
      'Set KOMA_LIBREOFFICE_EXECUTABLE to an installed LibreOffice for the PPTX integration test.',
    );
    test.setTimeout(120000);
    const running = await launchApplication();
    const { window, application, directory } = running;
    try {
      await writeFile(
        testInfo.outputPath(`${extension}-environment.json`),
        JSON.stringify(
          {
            bounds: await application.evaluate(({ BrowserWindow }) =>
              BrowserWindow.getAllWindows()[0]?.getBounds(),
            ),
            rendering: await window.evaluate(() => ({
              width: innerWidth,
              height: innerHeight,
              devicePixelRatio,
              reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
            })),
          },
          null,
          2,
        ),
      );
      await window.getByRole('button', { name: 'Create a project' }).click();
      const projectPath = join(directory, 'unchanged.koma');
      await answerSaveDialog(application, projectPath);
      await window.getByRole('button', { name: 'Save', exact: true }).click();
      await expect.poll(() => readFile(projectPath, 'utf8').catch(() => '')).not.toBe('');
      const before = await readFile(projectPath, 'utf8');
      await window.getByRole('button', { name: 'Brand Kit', exact: true }).click();
      await window.getByRole('tab', { name: /Library/ }).click();
      await window.getByRole('button', { name: 'Create Brand Kit from deck' }).click();
      const dialog = window.getByRole('dialog', { name: 'Create Brand Kit from deck' });
      await expect(dialog.getByLabel('Analysis provider and model')).toHaveValue('claude-code');
      await expect(dialog.getByRole('option', { name: /Mock provider/ })).toHaveCount(1);
      await dialog.getByLabel('Analysis provider and model').selectOption('mock');
      await window.screenshot({ path: testInfo.outputPath(`${extension}-01-upload.png`) });
      await answerOpenDialog(application, resolve(`e2e/fixtures/decks/northstar.${extension}`));
      await dialog.getByRole('button', { name: 'Choose PPTX or PDF' }).click();
      await expect(
        dialog.getByText(`northstar.${extension}`, { exact: true }).or(dialog.getByRole('alert')),
      ).toBeVisible({
        timeout: 70000,
      });
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      await expect(dialog.getByText('Prepared slides: 1, 2, 3 of 3.')).toBeVisible();
      await dialog.getByText('Inspect the content prepared for analysis').click();
      await expect(dialog.getByText(/Clear thinking. Confident design./)).toBeVisible();
      await window.screenshot({ path: testInfo.outputPath(`${extension}-02-prepared.png`) });
      await dialog.getByRole('button', { name: 'Create mock proposal' }).click();
      await expect(dialog.getByRole('status')).toContainText('mock proposal');
      await window.screenshot({ path: testInfo.outputPath(`${extension}-03-progress.png`) });
      const review = window.getByRole('dialog', { name: 'Review Brand Kit proposal' });
      await expect(review).toBeVisible();
      await review.getByLabel('Library name', { exact: true }).fill(`Northstar ${extension}`);
      await review.getByLabel('Brand name', { exact: true }).fill('Northstar Studio');
      await review.getByLabel('Tone', { exact: true }).fill('Clear, calm and confident');
      if (extension === 'pptx') {
        await review.getByLabel('I confirm this extracted image is the brand logo').check();
        await window.screenshot({ path: testInfo.outputPath('pptx-04-logo.png') });
      }
      await review.getByRole('img', { name: 'Preview of the Brand Kit' }).scrollIntoViewIfNeeded();
      await window.screenshot({ path: testInfo.outputPath(`${extension}-04-review.png`) });
      await review.getByRole('button', { name: 'Save new Brand Kit' }).click();
      await expect(review).not.toBeVisible();
      const item = window.getByRole('button', { name: `Northstar ${extension}`, exact: true });
      await expect(item).toBeVisible();
      await window.screenshot({ path: testInfo.outputPath(`${extension}-05-saved.png`) });
      // Library save does not dirty or mutate the project.
      expect(
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.isDocumentEdited(),
        ),
      ).toBe(false);
      expect(await readFile(projectPath, 'utf8')).toBe(before);
      const stored = z
        .object({ kits: z.array(savedBrandKitSchema) })
        .parse(
          JSON.parse(await readFile(join(directory, 'user-data/brand-kits/library.json'), 'utf8')),
        );
      expect(stored.kits[0]?.provenance?.fileName).toBe(`northstar.${extension}`);
      expect(stored.kits[0]?.provenance?.analyzedSlides).toEqual([1, 2, 3]);
      expect(stored.kits[0]?.brandKit.name).toBe('Northstar Studio');
      expect(stored.kits[0]?.logo !== null).toBe(extension === 'pptx');
      expect(JSON.stringify(stored)).not.toContain(directory);
      await window.getByRole('button', { name: 'Apply to this project' }).click();
      await expect(window.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
      await window.screenshot({ path: testInfo.outputPath(`${extension}-06-applied.png`) });
      await window.getByRole('button', { name: 'Save', exact: true }).click();
      await expect
        .poll(
          async () =>
            z
              .object({ brandKit: z.object({ name: z.string() }) })
              .parse(JSON.parse(await readFile(projectPath, 'utf8'))).brandKit.name,
        )
        .toBe('Northstar Studio');
      expect(running.problems).toEqual([]);
    } finally {
      await running.close();
    }
  });
}

test('encrypted PDF fails recoverably and leaves no deck temporary directory', async () => {
  const initial = new Set(
    (await readdir(tmpdir())).filter((name) => name.startsWith('koma-motion-deck-')),
  );
  const running = await launchApplication();
  try {
    const { window, application } = running;
    await window.getByRole('button', { name: 'Create a project' }).click();
    await window.getByRole('button', { name: 'Brand Kit', exact: true }).click();
    await window.getByRole('tab', { name: /Library/ }).click();
    await window.getByRole('button', { name: 'Create Brand Kit from deck' }).click();
    await answerOpenDialog(application, resolve('e2e/fixtures/decks/encrypted.pdf'));
    await window.getByRole('button', { name: 'Choose PPTX or PDF' }).click();
    await expect(window.getByRole('alert').filter({ hasText: 'password protected' })).toBeVisible();
    await window.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    const after = (await readdir(tmpdir())).filter(
      (name) => name.startsWith('koma-motion-deck-') && !initial.has(name),
    );
    expect(after).toEqual([]);
    await expect(window.getByText('No saved Brand Kits yet')).toBeVisible();
  } finally {
    await running.close();
  }
});

test('cancel discards analysis; library failure retains reviewed edits for retry', async () => {
  const running = await launchApplication();
  const { window, application, directory } = running;
  try {
    await window.getByRole('button', { name: 'Create a project' }).click();
    await window.getByRole('button', { name: 'Brand Kit', exact: true }).click();
    await window.getByRole('tab', { name: /Library/ }).click();
    const prepare = async () => {
      await window.getByRole('button', { name: 'Create Brand Kit from deck' }).click();
      const dialog = window.getByRole('dialog', { name: 'Create Brand Kit from deck' });
      await expect(dialog.getByRole('option', { name: /Mock provider/ })).toHaveCount(1);
      await dialog.getByLabel('Analysis provider and model').selectOption('mock');
      await answerOpenDialog(application, resolve('e2e/fixtures/decks/northstar.pdf'));
      await dialog.getByRole('button', { name: 'Choose PPTX or PDF' }).click();
      await expect(dialog.getByText('Prepared slides: 1, 2, 3 of 3.')).toBeVisible();
      await dialog.getByRole('button', { name: 'Create mock proposal' }).click();
      return dialog;
    };
    const dialog = await prepare();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(window.getByText('No saved Brand Kits yet')).toBeVisible();
    await prepare();
    const review = window.getByRole('dialog', { name: 'Review Brand Kit proposal' });
    await expect(review).toBeVisible();
    await review.getByLabel('Library name', { exact: true }).fill('Kept through failure');
    await review.getByLabel('Tone', { exact: true }).fill('Keep this reviewed tone');
    const obstacle = join(directory, 'user-data/brand-kits');
    await writeFile(obstacle, 'temporary test obstacle');
    await review.getByRole('button', { name: 'Save new Brand Kit' }).click();
    await expect(review.getByRole('alert')).toBeVisible();
    await expect(review.getByLabel('Tone', { exact: true })).toHaveValue('Keep this reviewed tone');
    await expect(review.getByLabel('Library name', { exact: true })).toHaveValue(
      'Kept through failure',
    );
    await unlink(obstacle);
    await review.getByRole('button', { name: 'Save new Brand Kit' }).click();
    await expect(
      window.getByRole('button', { name: 'Kept through failure', exact: true }),
    ).toBeVisible();
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});

test('discloses the selected sample and rejects too many pages and invalid PDFs', async () => {
  test.setTimeout(120000);
  const running = await launchApplication();
  try {
    const { window, application, directory } = running;
    await window.getByRole('button', { name: 'Create a project' }).click();
    await window.getByRole('button', { name: 'Brand Kit', exact: true }).click();
    await window.getByRole('tab', { name: /Library/ }).click();
    await window.getByRole('button', { name: 'Create Brand Kit from deck' }).click();
    await answerOpenDialog(application, resolve('e2e/fixtures/decks/sample-25.pdf'));
    await window.getByRole('button', { name: 'Choose PPTX or PDF' }).click();
    const dialog = window.getByRole('dialog', { name: 'Create Brand Kit from deck' });
    await expect(dialog.getByText(/A representative sample of 20 of 25 slides/)).toBeVisible({
      timeout: 30000,
    });
    const selected = Array.from({ length: 20 }, (_, index) => 1 + Math.round((index * 24) / 19));
    await expect(dialog.getByText(`Prepared slides: ${selected.join(', ')} of 25.`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    const malformed = join(directory, 'malformed.pdf');
    await writeFile(malformed, '%PDF-1.7\nnot a document');
    for (const path of [resolve('e2e/fixtures/decks/too-many-slides.pdf'), malformed]) {
      await window.getByRole('button', { name: 'Create Brand Kit from deck' }).click();
      await answerOpenDialog(application, path);
      await window.getByRole('button', { name: 'Choose PPTX or PDF' }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    }
    await expect(window.getByText('No saved Brand Kits yet')).toBeVisible();
  } finally {
    await running.close();
  }
});

test('normal shutdown cancels LibreOffice and removes isolated deck files', async () => {
  test.skip(
    !process.env['KOMA_LIBREOFFICE_EXECUTABLE'],
    'Local LibreOffice is required for shutdown-during-conversion coverage.',
  );
  const initial = new Set(
    (await readdir(tmpdir())).filter((name) => name.startsWith('koma-motion-deck-')),
  );
  const running = await launchApplication();
  let closed = false;
  try {
    const { window, application } = running;
    await window.getByRole('button', { name: 'Create a project' }).click();
    await window.getByRole('button', { name: 'Brand Kit', exact: true }).click();
    await window.getByRole('tab', { name: /Library/ }).click();
    await window.getByRole('button', { name: 'Create Brand Kit from deck' }).click();
    await answerOpenDialog(application, resolve('e2e/fixtures/decks/northstar.pptx'));
    await window.getByRole('button', { name: 'Choose PPTX or PDF' }).click();
    await expect(window.getByText('Creating a local PDF with LibreOffice')).toBeVisible();
    await running.close();
    closed = true;
    expect(
      (await readdir(tmpdir())).filter(
        (name) => name.startsWith('koma-motion-deck-') && !initial.has(name),
      ),
    ).toEqual([]);
  } finally {
    if (!closed) await running.close();
  }
});
