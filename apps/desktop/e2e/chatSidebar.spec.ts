import { expect, test, type Locator, type Page } from '@playwright/test';
import { isWideWindow, launchApplication, showChat, type RunningApplication } from './application';
import { openCountChoices } from './composerControls';

let running: RunningApplication;

test.beforeEach(async () => {
  running = await launchApplication();
});

test.afterEach(async () => {
  await running.close();
});

async function getBox(locator: Locator): Promise<{ x: number; width: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('The element has no visible bounds.');
  return { x: box.x, width: box.width };
}

function getParts(window: Page): {
  chat: Locator;
  canvas: Locator;
  inspector: Locator;
  divider: Locator;
} {
  return {
    chat: window.getByRole('complementary', { name: 'Studio dock', exact: true }),
    canvas: window.getByRole('region', { name: 'Canvas' }),
    inspector: window.getByRole('complementary', { name: 'Inspector' }),
    divider: window.getByRole('separator', { name: 'Resize studio dock' }),
  };
}

test('prompts beside the canvas, collapses, reopens and resizes the chat', async () => {
  const { window, problems } = running;
  test.skip(
    !(await isWideWindow(window)),
    'This sizing test needs a window at least 1400 pixels wide.',
  );
  await window.getByRole('button', { name: 'Create a project' }).click();
  const { chat, canvas, inspector, divider } = getParts(window);

  // One dock sits beside the larger canvas; Inspect shares that dock.
  const canvasBox = await getBox(canvas);
  const chatBox = await getBox(chat);
  expect(chatBox.x).toBeGreaterThanOrEqual(canvasBox.x + canvasBox.width);
  await expect(inspector).toBeHidden();
  await window.getByRole('tab', { name: 'Inspect', exact: true }).click();
  const inspectorBox = await getBox(inspector);
  expect(Math.abs(inspectorBox.width - chatBox.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(inspectorBox.x - chatBox.x)).toBeLessThanOrEqual(2);
  await showChat(window);

  // Prompt and submit without scrolling.
  const request = window.getByLabel('Your request');
  await expect(request).toBeInViewport({ ratio: 1 });
  await window.getByRole('button', { name: 'Use the example request' }).click();
  const generate = window.getByRole('button', { name: 'Generate Komas' });
  await expect(generate).toBeInViewport({ ratio: 1 });
  await generate.click();
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
  await expect(
    (await openCountChoices(window)).getByText('Replaces current Komas. Undo is available.'),
  ).toBeVisible();
  await window.keyboard.press('Escape');

  // Resize with the keyboard.
  const initialWidth = Number(await divider.getAttribute('aria-valuenow'));
  await divider.focus();
  await window.keyboard.press('ArrowLeft');
  await window.keyboard.press('Shift+ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', String(initialWidth + 80));
  expect(Math.round((await getBox(chat)).width)).toBe(initialWidth + 80);
  await window.keyboard.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '300');
  await window.keyboard.press('End');
  await expect(divider).toHaveAttribute(
    'aria-valuenow',
    (await divider.getAttribute('aria-valuemax')) ?? '',
  );

  // Undo still works while the divider has focus: the generation is undone.
  await window.keyboard.press('Control+z');
  await expect(window.getByRole('button', { name: /^Koma 1:/ })).toHaveCount(0);
  await window.keyboard.press('Control+y');
  await expect(window.getByRole('button', { name: /^Koma 1:/ })).toHaveCount(1);

  // Resize with the pointer: dragging to the right makes the chat narrower.
  await window.keyboard.press('Home');
  await window.keyboard.press('Shift+ArrowLeft');
  const before = await getBox(divider);
  await window.mouse.move(before.x + before.width / 2, 400);
  await window.mouse.down();
  await window.mouse.move(before.x + before.width / 2 - 100, 400, { steps: 5 });
  await window.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', '464');
  const chosenWidth = (await getBox(chat)).width;

  // Collapsing gives the canvas the space back and keeps focus on the toggle.
  const canvasBefore = (await getBox(canvas)).width;
  await request.fill('An unsent request');
  await window.getByRole('button', { name: 'Hide the chat' }).click();
  const show = window.getByRole('button', { name: 'Show the chat' });
  await expect(show).toBeFocused();
  await expect(request).toBeHidden();
  expect((await getBox(canvas)).width).toBeGreaterThan(canvasBefore + chosenWidth - 60);

  // Reopening restores the width, keeps the unsent request and focuses it.
  await window.keyboard.press('Enter');
  await expect(request).toBeFocused();
  await expect(request).toHaveValue('An unsent request');
  expect((await getBox(chat)).width).toBe(chosenWidth);

  // Text fields keep their own undo.
  await window.keyboard.type(' about bees');
  await window.keyboard.press('Control+z');
  await expect(window.getByRole('button', { name: /^Koma 1:/ })).toHaveCount(1);

  // The preferences outlive the page, and are not part of the project.
  await window.getByRole('button', { name: 'Hide the chat' }).click();
  await window.reload();
  await window.getByRole('button', { name: 'Create a project' }).click();
  await expect(window.getByRole('button', { name: 'Show the chat' })).toBeVisible();
  await window.getByRole('button', { name: 'Open the chat' }).click();
  await expect(window.getByLabel('Your request')).toBeFocused();
  expect((await getBox(chat)).width).toBe(chosenWidth);
  expect(problems).toEqual([]);
});

test('keeps the canvas and the chat usable in a narrow window', async () => {
  const { window, application, problems } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1024, 700);
  });
  await window.getByRole('button', { name: 'Create a project' }).click();
  const { chat, canvas, inspector } = getParts(window);

  // The chat takes the column of the Inspector instead of covering the canvas.
  await expect(inspector).toBeHidden();
  // The chat header offers only actions: no help buttons.
  await expect(chat.getByRole('button', { name: 'About the chat' })).toHaveCount(0);
  await expect(chat.getByRole('button', { name: 'Generation settings' })).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'Hide the chat' })).toBeVisible();
  const viewport = await window.evaluate(() => innerWidth);
  const canvasBox = await getBox(canvas);
  const chatBox = await getBox(chat);
  expect(canvasBox.width).toBeGreaterThanOrEqual(400);
  expect(chatBox.x).toBeGreaterThanOrEqual(canvasBox.x + canvasBox.width);
  expect(chatBox.x + chatBox.width).toBeLessThanOrEqual(viewport);

  await window.getByRole('button', { name: 'Use the example request' }).click();
  const generate = window.getByRole('button', { name: 'Generate Komas' });
  await generate.scrollIntoViewIfNeeded();
  // Nearly 1: a fractional device scale factor can clip part of a pixel.
  await expect(generate).toBeInViewport({ ratio: 0.95 });
  await generate.click();
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();

  const slider = window.getByLabel('Position in the transition');
  await expect(slider).toBeVisible();
  expect((await getBox(slider)).width).toBeGreaterThanOrEqual(96);
  await expect(window.getByLabel('Transition duration in seconds')).toBeInViewport({ ratio: 1 });
  await expect(window.getByRole('button', { name: 'Zoom in' })).toBeInViewport({ ratio: 1 });
  await window.screenshot({ path: test.info().outputPath('chat-narrow.png') });

  // Inspect shares the same dock without changing the canvas.
  await window.getByRole('tab', { name: 'Inspect', exact: true }).click();
  await expect(inspector).toBeVisible();
  expect(await getBox(canvas)).toEqual(canvasBox);
  await window.getByRole('button', { name: 'Hide Inspect panel' }).click();
  await expect(inspector).toBeHidden();
  await expect(window.getByRole('button', { name: 'Show the chat' })).toBeFocused();
  await window.screenshot({ path: test.info().outputPath('chat-narrow-collapsed.png') });
  expect(problems).toEqual([]);
});

test('shares the dock with Brand Kit in narrow and wide windows, preserving its context', async () => {
  const { window, application, problems } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  const { canvas } = getParts(window);
  const brandKit = window.getByRole('button', { name: 'Brand Kit', exact: true });
  const brandKitName = window.getByLabel('Brand name');
  for (const width of [1120, 1800]) {
    await application.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size, 800);
    }, width);
    await showChat(window);
    const canvasBefore = await getBox(canvas);
    await brandKit.click();
    await expect(brandKitName).toBeVisible();
    await expect(window.getByRole('region', { name: 'Agent chat' })).toBeHidden();
    expect(await getBox(canvas)).toEqual(canvasBefore);
    expect(canvasBefore.width).toBeGreaterThanOrEqual(420);
    await expect(window.getByRole('button', { name: 'Zoom in' })).toBeInViewport({ ratio: 1 });
    await showChat(window);
    await expect(brandKitName).toBeHidden();
    await expect(brandKit).toHaveAttribute('aria-pressed', 'false');
    // Clicking Brand Kit again returns to it rather than closing a hidden editor.
    await brandKit.click();
    await expect(brandKitName).toBeVisible();
    await expect(brandKit).toHaveAttribute('aria-pressed', 'true');
    await window.getByRole('button', { name: 'Back to Inspector' }).click();
    await expect(
      window.getByRole('complementary', { name: 'Inspector', exact: true }),
    ).toBeVisible();
  }
  expect(problems).toEqual([]);
});
