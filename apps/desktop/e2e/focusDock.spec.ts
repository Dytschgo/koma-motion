import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDefaultBrandKit, serialiseBrandKitLibrary } from '@koma-motion/brand-kit';
import { launchApplication, showChat, type RunningApplication } from './application';
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

test('reloads the saved library when returning to Inspect while retaining its tab', async () => {
  const { window, directory } = running;
  await window.getByRole('button', { name: 'Brand Kit', exact: true }).click();
  await window.getByRole('tab', { name: /^Library/ }).click();
  await expect(window.getByText('No saved Brand Kits yet', { exact: true })).toBeVisible();
  await showChat(window);
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
  await window.getByRole('tab', { name: 'Inspect', exact: true }).click();
  await expect(window.getByRole('tab', { name: /^Library/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(window.getByRole('button', { name, exact: true })).toBeVisible();
  expect(running.problems).toEqual([]);
});

test('shares a single dock and keeps drafts, transcript, selection and keyboard focus across contexts', async () => {
  const { window, application } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1480, 920);
  });
  await demo();
  const request = window.getByLabel('Your request');
  await request.fill('Keep this unfinished follow-up.');
  const chat = window.getByRole('tab', { name: 'Chat', exact: true });
  const inspect = window.getByRole('tab', { name: 'Inspect', exact: true });
  const canvas = window.getByRole('region', { name: 'Canvas' });
  const dock = window.getByRole('complementary', { name: 'Studio dock' });
  const bounds = await canvas.boundingBox();
  expect(bounds?.width).toBeGreaterThan(800);
  const originalDockWidth = (await dock.boundingBox())?.width;
  await chat.focus();
  await chat.press('ArrowRight');
  await expect(inspect).toBeFocused();
  await expect(inspect).toHaveAttribute('aria-selected', 'true');
  await expect(window.getByRole('complementary', { name: 'Inspector', exact: true })).toBeVisible();
  expect((await dock.boundingBox())?.width).toBe(originalDockWidth);
  expect((await canvas.boundingBox())?.width).toBe(bounds?.width);
  await inspect.press('Home');
  await expect(chat).toBeFocused();
  await expect(request).toHaveValue('Keep this unfinished follow-up.');
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
  await window.getByRole('button', { name: 'Koma 2: The motion engine', exact: true }).click();
  await expect(chat).toHaveAttribute('aria-selected', 'true');
  await canvas.locator('[data-element-id]').first().click({ force: true });
  await expect(inspect).toHaveAttribute('aria-selected', 'true');
  await expect(window.getByRole('tab', { name: /^Element:/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await window.getByRole('button', { name: 'Hide Inspector', exact: true }).click();
  await expect(window.getByRole('button', { name: 'Show the chat', exact: true })).toBeFocused();
  await window.getByRole('button', { name: 'Show the chat', exact: true }).press('Enter');
  await expect(request).toBeFocused();
  await expect(request).toHaveValue('Keep this unfinished follow-up.');
  await expect(
    window.getByRole('button', { name: 'Koma 2: The motion engine', exact: true }),
  ).toHaveAttribute('aria-current', 'true');
  await window.screenshot({ path: test.info().outputPath('wide-focus-dock.png'), scale: 'css' });
  expect(running.problems).toEqual([]);
});

test('keeps generation and review discoverable in Inspect without interrupting an edit', async () => {
  await demo();
  const { window } = running;
  await window.getByLabel('Generation scope').selectOption('selected');
  await window.getByLabel('Your request').fill('Refine this Koma.');
  await window.getByRole('button', { name: 'Generate Komas', exact: true }).click();
  await window.getByRole('tab', { name: 'Inspect', exact: true }).click();
  const chat = window.getByRole('tab', { name: 'Chat', exact: true });
  await expect(chat).toContainText('Generating');
  await expect(chat).toContainText('Review');
  await expect(window.getByRole('tab', { name: 'Inspect', exact: true })).toBeFocused();
  await showChat(window);
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

test('narrow shared dock preserves Brand Kit input, count and popups and offers Koma properties without an element', async () => {
  const { window, application } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1024, 655);
  });
  await window.emulateMedia({ reducedMotion: 'reduce' });
  await window.getByRole('button', { name: 'Add first Koma', exact: true }).click();
  await window.getByRole('button', { name: 'Inspect Koma', exact: true }).click();
  await expect(window.getByRole('tab', { name: 'Koma', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
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
  await expect(countTrigger(window)).toHaveAttribute('aria-description', '7 Komas');
  await openModelChoices(window);
  await window.getByRole('tab', { name: 'Inspect', exact: true }).click();
  await showChat(window);
  await expect(window.getByRole('dialog', { name: 'Model', exact: true })).toHaveCount(0);
  await window.getByRole('button', { name: 'Brand Kit', exact: true }).click();
  const brandName = window.getByLabel('Brand name');
  await brandName.fill('Shared dock kit');
  await brandName.blur();
  await showChat(window);
  await expect(window.getByLabel('Your request')).toHaveValue(
    'Make this Koma clearer while keeping its main idea and styling.',
  );
  await window.getByRole('tab', { name: 'Inspect', exact: true }).click();
  await expect(brandName).toHaveValue('Shared dock kit');
  await expect(window.getByRole('region', { name: 'Canvas' })).toBeInViewport();
  await window.screenshot({
    path: test.info().outputPath('narrow-brand-kit-dock.png'),
    scale: 'css',
  });
  expect(running.problems).toEqual([]);
});
