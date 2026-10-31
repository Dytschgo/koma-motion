import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDefaultBrandKit, serialiseBrandKitLibrary } from '@koma-motion/brand-kit';
import {
  launchApplication,
  openBrandKit,
  showChat,
  showInspector,
  type RunningApplication,
  showGenerationOptions,
} from './application';
import { countTrigger, openCountChoices, openModelChoices } from './composerControls';

let running: RunningApplication;
test.beforeEach(async () => {
  running = await launchApplication({ env: { KOMA_MOCK_DELAY_MS: '1200' } });
  await running.window.getByRole('button', { name: 'Create a project' }).click();
});
test.afterEach(async () => {
  await running.close();
});
async function demo() {
  await running.window.getByRole('button', { name: 'Use the example request' }).click();
  await running.window.getByRole('button', { name: 'Generate Komas', exact: true }).click();
  await expect(running.window.getByText(/Created 3 Komas/)).toBeVisible();
}

test('reloads the saved library when the Brand Kit opens again while retaining its tab', async () => {
  const { window, directory } = running;
  await openBrandKit(window);
  await window.getByRole('tab', { name: /^Library/ }).click();
  await expect(window.getByText('No saved Brand Kits yet', { exact: true })).toBeVisible();
  await window.getByRole('button', { name: 'Close properties', exact: true }).click();
  const folder = join(directory, 'user-data', 'brand-kits');
  await mkdir(folder, { recursive: true });
  const name = 'Arrived from another window';
  await writeFile(
    join(folder, 'library.json'),
    serialiseBrandKitLibrary([
      {
        id: 'external-kit',
        name,
        createdAt: '2026-10-01T12:00:00Z',
        updatedAt: '2026-10-01T12:00:00Z',
        logo: null,
        brandKit: { ...createDefaultBrandKit(), name, logoAssetId: null },
      },
    ]),
  );
  await openBrandKit(window);
  await expect(window.getByRole('tab', { name: /^Library/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(window.getByRole('button', { name, exact: true })).toBeVisible();
  expect(running.problems).toEqual([]);
});

test('keeps drafts, transcript, selection and focus while properties open and close', async () => {
  const { window, application } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1480, 920);
  });
  await demo();
  const request = window.getByLabel('Your request');
  await request.fill('Keep this unfinished follow-up.');
  const canvas = window.getByRole('region', { name: 'Canvas' });
  const bounds = await canvas.boundingBox();
  const viewportWidth = await window.evaluate(() => innerWidth);
  // Canvas first: no Koma column and no dock take width from the canvas.
  expect(Math.abs((bounds?.width ?? 0) - viewportWidth)).toBeLessThanOrEqual(2);
  await expect(window.getByRole('region', { name: 'Properties', exact: true })).toBeHidden();

  // Properties float over the canvas and close with Escape, returning focus.
  const properties = window.getByRole('button', { name: 'Properties', exact: true });
  await properties.click();
  await expect(window.getByRole('complementary', { name: 'Inspector', exact: true })).toBeVisible();
  expect((await canvas.boundingBox())?.width).toBe(bounds?.width);
  await window.keyboard.press('Escape');
  await expect(window.getByRole('region', { name: 'Properties', exact: true })).toBeHidden();
  await expect(properties).toBeFocused();
  await expect(request).toHaveValue('Keep this unfinished follow-up.');
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();

  // Selecting an element shows its toolbar; it does not open a panel by itself.
  await window.getByRole('button', { name: 'Koma 2: The motion engine', exact: true }).click();
  await canvas.locator('[data-element-id]').first().click({ force: true });
  const toolbar = window.getByRole('toolbar', { name: 'Element actions' });
  await expect(toolbar).toBeVisible();
  await expect(window.getByRole('region', { name: 'Properties', exact: true })).toBeHidden();
  await toolbar.getByRole('button', { name: 'More', exact: true }).click();
  await window.getByRole('menuitem', { name: 'Properties', exact: true }).click();
  await expect(window.getByRole('tab', { name: /^Element:/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(request).toHaveValue('Keep this unfinished follow-up.');
  await expect(
    window.getByRole('button', { name: 'Koma 2: The motion engine', exact: true }),
  ).toHaveAttribute('aria-current', 'true');
  await window.screenshot({ path: test.info().outputPath('wide-properties.png'), scale: 'css' });
  expect(running.problems).toEqual([]);
});

test('keeps generation and review discoverable while the conversation is collapsed', async () => {
  await demo();
  const { window } = running;
  await window.getByLabel('Generation scope').selectOption('selected');
  await window.getByLabel('Your request').fill('Refine this Koma.');
  await window.getByRole('button', { name: 'Generate Komas', exact: true }).click();
  await window.getByRole('button', { name: 'Hide the chat', exact: true }).click();
  const show = window.getByRole('button', { name: 'Show the chat', exact: true });
  await expect(show).toHaveAttribute('aria-description', 'Generating');
  // A proposal to review opens the conversation where the request was made.
  const proposal = window.getByRole('region', { name: 'Selected Koma proposal' });
  await expect(proposal).toBeVisible();
  await proposal.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(window.getByRole('button', { name: /^Koma 1: Revised:/ })).toBeVisible();
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    window.getByRole('button', { name: 'Koma 1: One connected system', exact: true }),
  ).toBeVisible();
  expect(running.problems).toEqual([]);
});

test('narrow window preserves Brand Kit input, count and popups and offers Koma properties without an element', async () => {
  const { window, application } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1024, 655);
  });
  await window.emulateMedia({ reducedMotion: 'reduce' });
  await window.getByRole('button', { name: 'Add first Koma', exact: true }).click();
  await showInspector(window);
  await expect(window.getByRole('tab', { name: 'Koma', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await window.getByRole('button', { name: 'Close properties', exact: true }).click();
  await showChat(window);
  const counts = await openCountChoices(window);
  await counts.getByRole('spinbutton', { name: 'Komas' }).fill('7');
  await window.keyboard.press('Escape');
  await window.getByLabel('Generation scope').selectOption('selected');
  await window.getByRole('button', { name: 'Use the example request' }).click();
  await expect(window.getByLabel('Your request')).toHaveValue(
    'Make this Koma clearer while keeping its main idea and styling.',
  );
  await window.getByLabel('Generation scope').selectOption('entire');
  await showGenerationOptions(window);
  await expect(countTrigger(window)).toHaveAttribute('aria-description', '7 Komas');
  await openModelChoices(window);
  // Opening properties dismisses the composer popup.
  await window.getByRole('button', { name: 'Properties', exact: true }).click();
  await expect(window.getByRole('dialog', { name: 'Model', exact: true })).toHaveCount(0);
  await openBrandKit(window);
  const brandName = window.getByLabel('Brand name');
  await brandName.fill('Shared dock kit');
  await brandName.blur();
  await window.getByRole('button', { name: 'Close properties', exact: true }).click();
  await expect(window.getByLabel('Your request')).toHaveValue(
    'Make this Koma clearer while keeping its main idea and styling.',
  );
  await openBrandKit(window);
  await expect(brandName).toHaveValue('Shared dock kit');
  await expect(window.getByRole('region', { name: 'Canvas' })).toBeInViewport();
  await window.screenshot({
    path: test.info().outputPath('narrow-brand-kit.png'),
    scale: 'css',
  });
  expect(running.problems).toEqual([]);
});
