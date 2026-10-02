import { savedBrandKitSchema } from '@koma-motion/brand-kit';
import { copyFile, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { z } from 'zod';
import { answerSaveDialog, launchApplication, type RunningApplication } from './application';

const projectFileSchema = z.object({
  brandKit: z.object({ name: z.string(), tone: z.string(), logoAssetId: z.string().nullable() }),
  systemInstructions: z.string().optional(),
  assets: z.array(z.object({ id: z.string(), name: z.string() })),
});
const readProject = async (path: string) =>
  projectFileSchema.parse(JSON.parse(await readFile(path, 'utf8')));

/** Makes the next "Open" dialog answer with several files, as a multiple selection does. */
async function answerOpenDialogWith(
  application: ElectronApplication,
  filePaths: readonly string[],
): Promise<void> {
  await application.evaluate(
    ({ dialog }, chosen) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: chosen });
    },
    [...filePaths],
  );
}

const isEdited = (application: ElectronApplication) =>
  application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isDocumentEdited());

/** A PNG, a JPEG made from it, and the synthetic Northstar PDF. No user data. */
async function fixtures(running: RunningApplication): Promise<string[]> {
  const png = join(running.directory, 'northstar-logo.png');
  await copyFile(resolve('e2e/fixtures/decks/logo.png'), png);
  const jpeg = join(running.directory, 'northstar-photo.jpg');
  const data = await running.application.evaluate(
    ({ nativeImage }, source) => nativeImage.createFromPath(source).toJPEG(85).toString('base64'),
    png,
  );
  await writeFile(jpeg, Buffer.from(data, 'base64'));
  return [png, jpeg, resolve('e2e/fixtures/decks/northstar.pdf')];
}

async function attach(running: RunningApplication, paths: readonly string[]): Promise<void> {
  const { window, application } = running;
  await answerOpenDialogWith(application, paths);
  await window.getByRole('button', { name: 'Choose Brand Kit', exact: true }).click();
  await window
    .getByRole('dialog', { name: 'Choose Brand Kit', exact: true })
    .getByRole('button', { name: 'Attach brand material…' })
    .click();
}

/** Attaches the fixtures and opens the disclosure step with the mock provider selected. */
async function openDisclosure(running: RunningApplication): Promise<ReturnType<Page['getByRole']>> {
  const { window } = running;
  await attach(running, await fixtures(running));
  await expect(window.getByRole('list', { name: 'Attached brand material' })).toContainText(
    'northstar.pdf',
    { timeout: 60_000 },
  );
  await window.getByRole('button', { name: 'Create Brand Kit and instructions' }).click();
  const dialog = window.getByRole('dialog', { name: 'Create Brand Kit and instructions' });
  // Claude Code · Opus is the default. The mock is an explicit choice of this test.
  await expect(dialog.getByLabel('Analysis provider and model')).toHaveValue('claude-code');
  await expect(dialog.getByRole('option', { name: /Mock provider/ })).toHaveCount(1);
  await dialog.getByLabel('Analysis provider and model').selectOption('mock');
  return dialog;
}

test('attach files in chat, review both outputs, save and apply as one undoable change, reuse in another project', async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(180_000);
  const running = await launchApplication({ env: { KOMA_MOCK_DELAY_MS: '700' } });
  const { window, application, directory } = running;
  try {
    await writeFile(
      testInfo.outputPath('environment.json'),
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
    const projectPath = join(directory, 'first.koma');
    await answerSaveDialog(application, projectPath);
    await window.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => readFile(projectPath, 'utf8').catch(() => '')).not.toBe('');
    const before = await readFile(projectPath, 'utf8');
    const original = await readProject(projectPath);

    const dialog = await openDisclosure(running);
    await window.screenshot({ path: testInfo.outputPath('01-attached-and-disclosure.png') });
    // The disclosure names every file and what is prepared from it. No path is shown.
    const files = dialog.getByRole('list', { name: 'Files to analyze' });
    await expect(files.getByRole('listitem')).toHaveText([
      'northstar-logo.png · Image · 1 preview',
      'northstar-photo.jpg · Image · 1 preview',
      'northstar.pdf · PDF · slides 1, 2, 3 of 3',
    ]);
    await expect(dialog.getByText('3 files · 5 prepared items')).toBeVisible();
    await expect(dialog.getByText(/does not analyze your files or send content/)).toBeVisible();
    await dialog.getByLabel('Analysis provider and model').selectOption('claude-code');
    await expect(dialog.getByText(/5 prepared previews listed above/)).toContainText(
      'File names, file paths and the original files stay on this computer',
    );
    await dialog.getByLabel('Analysis provider and model').selectOption('mock');
    await expect(dialog).not.toContainText(directory);
    await dialog.getByText('Inspect the content prepared for analysis').click();
    await expect(dialog.getByText(/Clear thinking. Confident design./)).toBeVisible();
    await expect(
      dialog.getByRole('img', { name: 'Prepared preview of northstar-photo.jpg' }),
    ).toBeVisible();
    await expect
      .poll(() =>
        dialog
          .getByRole('img', { name: 'Prepared preview of northstar-photo.jpg' })
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    await window.screenshot({ path: testInfo.outputPath('02-prepared-content.png') });
    expect(await isEdited(application)).toBe(false);

    await dialog.getByRole('button', { name: 'Create mock proposal' }).click();
    await expect(dialog.getByRole('status')).toContainText('mock proposal');
    const review = window.getByRole('dialog', { name: 'Review Brand Kit and instructions' });
    await expect(review).toBeVisible();
    // Uncertainty is shown, and fonts are not presented as identified.
    await expect(review.getByText(/low confidence/).first()).toBeVisible();
    await expect(review.getByText(/not an identification/)).toBeVisible();
    // Brand Kit data and instructions are separate regions with their own fields.
    const kit = review.getByRole('region', { name: 'Brand Kit', exact: true });
    const instructions = review.getByRole('region', { name: 'Project instructions' });
    await expect(kit.getByLabel('Instructions for this brand')).toHaveCount(0);
    await expect(instructions.getByLabel('Tone', { exact: true })).toHaveCount(0);
    await review.getByLabel('Library name', { exact: true }).fill('Northstar profile');
    await kit.getByLabel('Brand name', { exact: true }).fill('Northstar Studio');
    await kit.getByLabel('Tone', { exact: true }).fill('Clear, calm and confident');
    await instructions
      .getByLabel('Instructions for this brand')
      .fill('Reviewed: one idea per Koma, navy backgrounds, short headlines.');
    await kit.getByLabel(/Use the image from northstar-logo.png as the logo/).check();
    await kit.getByRole('img', { name: 'Preview of the Brand Kit' }).scrollIntoViewIfNeeded();
    await window.screenshot({ path: testInfo.outputPath('03-review-brand-kit.png') });
    await instructions.scrollIntoViewIfNeeded();
    await window.screenshot({ path: testInfo.outputPath('04-review-instructions.png') });
    // Reviewing and editing changed neither the project nor the library.
    expect(await isEdited(application)).toBe(false);
    await expect(stat(join(directory, 'user-data/brand-kits/library.json'))).rejects.toThrow();

    await review.getByRole('button', { name: 'Save and apply' }).click();
    await expect(review).not.toBeVisible();
    await expect(
      window.getByText(/Saved "Northstar profile" and applied its Brand Kit and instructions/),
    ).toBeVisible();
    await expect(window.getByRole('list', { name: 'Attached brand material' })).toHaveCount(0);
    await window.screenshot({ path: testInfo.outputPath('05-saved-and-applied.png') });

    const stored = z
      .object({ kits: z.array(savedBrandKitSchema) })
      .parse(
        JSON.parse(await readFile(join(directory, 'user-data/brand-kits/library.json'), 'utf8')),
      );
    expect(stored.kits).toHaveLength(1);
    expect(stored.kits[0]).toMatchObject({
      name: 'Northstar profile',
      brandKit: { name: 'Northstar Studio', tone: 'Clear, calm and confident' },
      instructions: 'Reviewed: one idea per Koma, navy backgrounds, short headlines.',
      logo: { name: 'northstar-logo.png', mediaType: 'image/png' },
      referenceProvenance: {
        provider: 'mock',
        files: [
          { fileName: 'northstar-logo.png', kind: 'image', analyzed: 1, total: 1 },
          { fileName: 'northstar-photo.jpg', kind: 'image', analyzed: 1, total: 1 },
          { fileName: 'northstar.pdf', kind: 'pdf', analyzed: 3, total: 3 },
        ],
      },
    });
    expect(JSON.stringify(stored)).not.toContain(directory);

    // Applied to the project: kit, logo and instructions.
    expect(await readFile(projectPath, 'utf8')).toBe(before);
    await window.getByRole('button', { name: 'Save', exact: true }).click();
    await expect
      .poll(async () => (await readProject(projectPath)).systemInstructions)
      .toBe('Reviewed: one idea per Koma, navy backgrounds, short headlines.');
    const applied = await readProject(projectPath);
    expect(applied.brandKit).toMatchObject({
      name: 'Northstar Studio',
      tone: 'Clear, calm and confident',
    });
    expect(applied.assets.find((asset) => asset.id === applied.brandKit.logoAssetId)?.name).toBe(
      'northstar-logo.png',
    );

    // One Undo takes back kit, logo and instructions together.
    await window.getByRole('button', { name: 'Undo' }).click();
    await expect(window.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await window.getByRole('button', { name: 'Save', exact: true }).click();
    await expect
      .poll(async () => (await readProject(projectPath)).brandKit.name)
      .toBe(original.brandKit.name);
    const undone = await readProject(projectPath);
    expect(undone.systemInstructions ?? '').toBe(original.systemInstructions ?? '');
    expect(undone.brandKit.logoAssetId).toBeNull();
    expect(undone.assets).toEqual([]);
    await window.getByRole('button', { name: 'Redo' }).click();
    await window.getByRole('button', { name: 'Save', exact: true }).click();
    await expect
      .poll(async () => (await readProject(projectPath)).brandKit.name)
      .toBe('Northstar Studio');

    // Another project reuses the saved profile from the library.
    await window.getByRole('button', { name: 'New', exact: true }).click();
    await expect(window.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await window.getByRole('button', { name: 'Brand Kit', exact: true }).click();
    await window.getByRole('tab', { name: /Library/ }).click();
    // The library still has the profile selected from the save in the first project.
    const saved = window.getByRole('button', { name: 'Northstar profile', exact: true });
    if ((await saved.getAttribute('aria-pressed')) !== 'true') await saved.click();
    await expect(window.getByText('Includes project instructions')).toBeVisible();
    await window.getByText('Saved project instructions').click();
    await window.screenshot({ path: testInfo.outputPath('06-reuse-in-another-project.png') });
    await window.getByRole('button', { name: 'Apply kit and instructions' }).click();
    await expect(
      window.getByText(/Applied "Northstar profile" and its instructions to this project/),
    ).toBeVisible();
    const secondPath = join(directory, 'second.koma');
    await answerSaveDialog(application, secondPath);
    await window.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => readFile(secondPath, 'utf8').catch(() => '')).not.toBe('');
    const second = await readProject(secondPath);
    expect(second.systemInstructions).toBe(
      'Reviewed: one idea per Koma, navy backgrounds, short headlines.',
    );
    expect(second.brandKit.name).toBe('Northstar Studio');
    expect(second.assets.find((asset) => asset.id === second.brandKit.logoAssetId)?.name).toBe(
      'northstar-logo.png',
    );
    await window.getByRole('button', { name: 'Undo' }).click();
    await expect(window.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});

test('refuses too many, unsupported and undecodable files without attaching anything', async () => {
  const running = await launchApplication();
  const { window, application, directory } = running;
  try {
    await window.getByRole('button', { name: 'Create a project' }).click();
    const [png = ''] = await fixtures(running);
    const many = [];
    for (let index = 0; index < 9; index += 1) {
      const copy = join(directory, `copy-${String(index)}.png`);
      await copyFile(png, copy);
      many.push(copy);
    }
    const chat = window.getByRole('region', { name: 'Agent chat' });
    await attach(running, many);
    await expect(chat.getByRole('alert')).toContainText('Choose at most 8 files');
    await expect(window.getByRole('list', { name: 'Attached brand material' })).toHaveCount(0);
    await expect(
      window.getByRole('button', { name: 'Create Brand Kit and instructions' }),
    ).toHaveCount(0);

    const text = join(directory, 'notes.txt');
    await writeFile(text, 'Not brand material');
    await answerOpenDialogWith(application, [png, text]);
    await chat.getByRole('button', { name: 'Choose files again' }).click();
    await expect(chat.getByRole('alert')).toContainText('"notes.txt" is not supported');

    const fake = join(directory, 'renamed.png');
    await writeFile(fake, 'This is text with an image extension');
    await answerOpenDialogWith(application, [fake]);
    await chat.getByRole('button', { name: 'Choose files again' }).click();
    await expect(chat.getByRole('alert')).toContainText('not a PNG, JPEG, WebP or GIF image');
    await expect(chat.getByRole('alert')).not.toContainText(directory);
    await chat.getByRole('button', { name: 'Dismiss' }).click();
    await expect(chat.getByRole('alert')).toHaveCount(0);
    expect(await isEdited(application)).toBe(false);
    await expect(stat(join(directory, 'user-data/brand-kits/library.json'))).rejects.toThrow();
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});

test('cancelling the analysis keeps the files and changes nothing; discarding a proposal changes nothing', async () => {
  test.setTimeout(120_000);
  const running = await launchApplication({ env: { KOMA_MOCK_DELAY_MS: '6000' } });
  const { window, application, directory } = running;
  try {
    await window.getByRole('button', { name: 'Create a project' }).click();
    const dialog = await openDisclosure(running);
    await dialog.getByRole('button', { name: 'Create mock proposal' }).click();
    await expect(dialog.getByRole('status')).toContainText('mock proposal');
    await dialog.getByRole('button', { name: 'Cancel analysis' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Analysis was cancelled');
    // The cancelled run leaves no proposal behind, also after its delay has passed.
    await window.waitForTimeout(6500);
    await expect(
      window.getByRole('dialog', { name: 'Review Brand Kit and instructions' }),
    ).toHaveCount(0);
    await expect(dialog.getByRole('list', { name: 'Files to analyze' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(window.getByRole('list', { name: 'Attached brand material' })).toBeVisible();
    expect(await isEdited(application)).toBe(false);
    await expect(stat(join(directory, 'user-data/brand-kits/library.json'))).rejects.toThrow();

    await window.getByRole('button', { name: 'Remove brand material' }).click();
    await expect(window.getByRole('list', { name: 'Attached brand material' })).toHaveCount(0);
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});

test('invalid agent output is refused: no proposal, no library entry, no project change', async () => {
  test.setTimeout(120_000);
  const running = await launchApplication({
    env: { KOMA_MOCK_DELAY_MS: '200', KOMA_MOCK_OUTCOME: 'invalid' },
  });
  const { window, application, directory } = running;
  try {
    await window.getByRole('button', { name: 'Create a project' }).click();
    const dialog = await openDisclosure(running);
    await dialog.getByRole('button', { name: 'Create mock proposal' }).click();
    await expect(dialog.getByRole('alert')).toContainText(
      'unsupported resource, command or credential content',
    );
    await expect(
      window.getByRole('dialog', { name: 'Review Brand Kit and instructions' }),
    ).toHaveCount(0);
    // The refused text is not shown or offered anywhere.
    await expect(dialog).not.toContainText('example.invalid');
    await expect(dialog.getByRole('button', { name: 'Save and apply' })).toHaveCount(0);
    expect(await isEdited(application)).toBe(false);
    await expect(stat(join(directory, 'user-data/brand-kits/library.json'))).rejects.toThrow();
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});

test('a failed library save applies nothing and keeps the reviewed draft for a retry', async () => {
  test.setTimeout(120_000);
  const running = await launchApplication({ env: { KOMA_MOCK_DELAY_MS: '200' } });
  const { window, application, directory } = running;
  try {
    await window.getByRole('button', { name: 'Create a project' }).click();
    const dialog = await openDisclosure(running);
    await dialog.getByRole('button', { name: 'Create mock proposal' }).click();
    const review = window.getByRole('dialog', { name: 'Review Brand Kit and instructions' });
    await expect(review).toBeVisible();
    await review.getByLabel('Library name', { exact: true }).fill('Kept through failure');
    await review.getByLabel('Instructions for this brand').fill('Keep these reviewed instructions');
    const obstacle = join(directory, 'user-data/brand-kits');
    await writeFile(obstacle, 'temporary test obstacle');
    await review.getByRole('button', { name: 'Save and apply' }).click();
    await expect(review.getByRole('alert')).toContainText('The project was not changed');
    // Neither half happened: nothing saved, nothing applied, edits still there.
    expect(await isEdited(application)).toBe(false);
    await expect(window.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await expect(review.getByLabel('Instructions for this brand')).toHaveValue(
      'Keep these reviewed instructions',
    );
    await expect(review.getByLabel('Library name', { exact: true })).toHaveValue(
      'Kept through failure',
    );
    await unlink(obstacle);
    await review.getByRole('button', { name: 'Save and apply' }).click();
    await expect(review).not.toBeVisible();
    await expect(window.getByText(/Saved "Kept through failure" and applied/)).toBeVisible();
    const stored = z
      .object({ kits: z.array(savedBrandKitSchema) })
      .parse(JSON.parse(await readFile(join(obstacle, 'library.json'), 'utf8')));
    expect(stored.kits.map((kit) => [kit.name, kit.instructions])).toEqual([
      ['Kept through failure', 'Keep these reviewed instructions'],
    ]);
    await expect(window.getByRole('button', { name: 'Undo' })).toBeEnabled();
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});

test('applying without saving changes the project only, and discarding a proposal asks first', async () => {
  test.setTimeout(120_000);
  const running = await launchApplication({ env: { KOMA_MOCK_DELAY_MS: '200' } });
  const { window, application, directory } = running;
  try {
    await window.getByRole('button', { name: 'Create a project' }).click();
    await window.getByLabel('Your request').fill('Create three Komas about Northstar.');
    let dialog = await openDisclosure(running);
    await dialog.getByRole('button', { name: 'Create mock proposal' }).click();
    let review = window.getByRole('dialog', { name: 'Review Brand Kit and instructions' });
    await review.getByRole('button', { name: 'Discard', exact: true }).click();
    const confirmation = window.getByRole('dialog', { name: 'Discard this proposal?' });
    await confirmation.getByRole('button', { name: 'Keep reviewing' }).click();
    await expect(review).toBeVisible();
    await review.getByRole('button', { name: 'Discard', exact: true }).click();
    await confirmation.getByRole('button', { name: 'Discard proposal' }).click();
    await expect(review).not.toBeVisible();
    await expect(window.getByRole('list', { name: 'Attached brand material' })).toHaveCount(0);
    expect(await isEdited(application)).toBe(false);

    dialog = await openDisclosure(running);
    await dialog.getByRole('button', { name: 'Create mock proposal' }).click();
    review = window.getByRole('dialog', { name: 'Review Brand Kit and instructions' });
    await review.getByLabel('Brand name', { exact: true }).fill('Applied only');
    // Enter in a review field belongs to the dialog. It never sends the waiting chat request.
    await review.getByLabel('Brand name', { exact: true }).press('Enter');
    await expect(review).toBeVisible();
    await expect(window.getByRole('log', { name: 'Conversation' })).not.toContainText('You asked');
    await review.getByRole('button', { name: 'Apply without saving' }).click();
    await expect(review).not.toBeVisible();
    await expect(window.getByText(/They were not saved to the library/)).toBeVisible();
    await expect(window.getByRole('button', { name: 'Undo' })).toBeEnabled();
    await expect(stat(join(directory, 'user-data/brand-kits/library.json'))).rejects.toThrow();
    await window.getByRole('button', { name: 'Undo' }).click();
    await expect(window.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});

test('prepares a PPTX with LibreOffice alongside an image', async () => {
  test.skip(
    !process.env['KOMA_LIBREOFFICE_EXECUTABLE'],
    'Set KOMA_LIBREOFFICE_EXECUTABLE to an installed LibreOffice for the PPTX integration test.',
  );
  test.setTimeout(180_000);
  const running = await launchApplication({ env: { KOMA_MOCK_DELAY_MS: '200' } });
  const { window } = running;
  try {
    await window.getByRole('button', { name: 'Create a project' }).click();
    const [png = ''] = await fixtures(running);
    await attach(running, [png, resolve('e2e/fixtures/decks/northstar.pptx')]);
    await expect(window.getByRole('list', { name: 'Attached brand material' })).toContainText(
      'northstar.pptx',
      { timeout: 90_000 },
    );
    await window.getByRole('button', { name: 'Create Brand Kit and instructions' }).click();
    const dialog = window.getByRole('dialog', { name: 'Create Brand Kit and instructions' });
    await expect(dialog.getByRole('list', { name: 'Files to analyze' })).toContainText(
      'northstar.pptx · PowerPoint · slides 1, 2, 3 of 3',
    );
    await expect(dialog.getByText(/LibreOffice may substitute unavailable fonts/)).toBeVisible();
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});
