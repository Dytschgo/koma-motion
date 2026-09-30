import { expect, test, type Locator, type Page } from '@playwright/test';
import { isWideWindow, launchApplication, type RunningApplication } from './application';

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
    chat: window.getByRole('region', { name: 'Agent chat' }),
    canvas: window.getByRole('region', { name: 'Canvas' }),
    inspector: window.getByRole('complementary', { name: 'Inspector' }),
    divider: window.getByRole('separator', { name: 'Resize the chat' }),
  };
}

test('prompts beside the canvas, collapses, reopens and resizes the chat', async () => {
  const { window, problems } = running;
  test.skip(
    !(await isWideWindow(window)),
    'The screen of this machine cannot hold the canvas, the Inspector and the chat side by side.',
  );
  await window.getByRole('button', { name: 'Create a project' }).click();
  const { chat, canvas, inspector, divider } = getParts(window);

  // The chat is a sidebar to the right of the canvas and the Inspector.
  const canvasBox = await getBox(canvas);
  const inspectorBox = await getBox(inspector);
  const chatBox = await getBox(chat);
  expect(chatBox.x).toBeGreaterThanOrEqual(canvasBox.x + canvasBox.width);
  expect(chatBox.x).toBeGreaterThanOrEqual(inspectorBox.x + inspectorBox.width);

  // Prompt and submit without scrolling.
  const request = window.getByLabel('Your request');
  await expect(request).toBeInViewport({ ratio: 1 });
  await window.getByRole('button', { name: 'Use the example request' }).click();
  const generate = window.getByRole('button', { name: 'Generate Komas' });
  await expect(generate).toBeInViewport({ ratio: 1 });
  await generate.click();
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
  await expect(window.getByText('Replaces current Komas. Undo is available.')).toBeVisible();

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
  await window.getByRole('button', { name: 'About the chat', exact: true }).focus();
  await expect(window.getByRole('tooltip')).toContainText('Hide the chat to see the Inspector');
  await window.keyboard.press('Escape');
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

  // Hiding the chat brings the Inspector back.
  await window.getByRole('button', { name: 'Hide the chat' }).click();
  await expect(inspector).toBeVisible();
  await expect(window.getByRole('button', { name: 'Show the chat' })).toBeFocused();
  await window.screenshot({ path: test.info().outputPath('chat-narrow-collapsed.png') });
  expect(problems).toEqual([]);
});

test('lets the Brand Kit and the chat take turns in a narrow window', async () => {
  const { window, application, problems } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1120, 760);
  });
  await window.getByRole('button', { name: 'Create a project' }).click();
  const { chat, canvas } = getParts(window);
  const brandKit = window.getByRole('button', { name: 'Brand Kit', exact: true });
  const brandKitName = window.getByLabel('Brand name');
  await expect(chat).toBeVisible();

  // Opening the Brand Kit collapses the chat, so the canvas keeps its room.
  await brandKit.click();
  await expect(brandKitName).toBeVisible();
  await expect(window.getByRole('button', { name: 'Show the chat' })).toBeVisible();
  expect((await getBox(canvas)).width).toBeGreaterThanOrEqual(400);
  await expect(window.getByRole('button', { name: 'Zoom in' })).toBeInViewport({ ratio: 1 });

  // Closing the Brand Kit brings the chat back.
  await window.getByRole('button', { name: 'Close panel' }).click();
  await expect(chat).toBeVisible();

  // Opening the chat while the Brand Kit is open closes the Brand Kit.
  await brandKit.click();
  await expect(brandKitName).toBeVisible();
  await window.getByRole('button', { name: 'Show the chat' }).click();
  await expect(chat).toBeVisible();
  await expect(brandKitName).toBeHidden();
  await expect(brandKit).toHaveAttribute('aria-pressed', 'false');
  expect((await getBox(canvas)).width).toBeGreaterThanOrEqual(400);
  expect(problems).toEqual([]);
});

test('shows the Brand Kit and the chat side by side in a wide window', async () => {
  const { window, application, problems } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1800, 900);
  });
  await window.getByRole('button', { name: 'Create a project' }).click();
  const { chat, canvas } = getParts(window);
  await window.getByRole('button', { name: 'Brand Kit', exact: true }).click();
  await expect(window.getByLabel('Brand name')).toBeVisible();
  await expect(chat).toBeVisible();
  expect((await getBox(canvas)).width).toBeGreaterThanOrEqual(420);
  expect(problems).toEqual([]);
});
