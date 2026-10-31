import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  launchApplication,
  openBrandKit,
  showChat,
  showInspector,
  type RunningApplication,
} from './application';
import { openCountChoices } from './composerControls';

let running: RunningApplication;

test.beforeEach(async () => {
  running = await launchApplication();
});

test.afterEach(async () => {
  await running.close();
});

async function getBox(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('The element has no visible bounds.');
  return box;
}

function getParts(window: Page): {
  prompt: Locator;
  canvas: Locator;
  conversation: Locator;
  filmstrip: Locator;
} {
  return {
    prompt: window.getByRole('region', { name: 'Agent chat', exact: true }),
    canvas: window.getByRole('region', { name: 'Canvas' }),
    conversation: window.getByRole('log', { name: 'Conversation' }),
    filmstrip: window.getByRole('region', { name: 'Filmstrip' }),
  };
}

test('asks below the canvas and keeps the draft when the conversation collapses', async () => {
  const { window, problems } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  const { prompt, canvas, conversation, filmstrip } = getParts(window);

  // An empty project opens its conversation to show how to start.
  await expect(conversation).toBeVisible();
  const request = window.getByLabel('Your request');
  await expect(request).toBeInViewport({ ratio: 1 });
  // The prompt sits between the canvas and the filmstrip.
  const canvasBox = await getBox(canvas);
  const promptBox = await getBox(prompt);
  const stripBox = await getBox(filmstrip);
  expect(promptBox.y).toBeGreaterThanOrEqual(canvasBox.y + canvasBox.height - 1);
  expect(stripBox.y).toBeGreaterThanOrEqual(promptBox.y + promptBox.height - 1);

  await window.getByRole('button', { name: 'Use the example request' }).click();
  const generate = window.getByRole('button', { name: 'Generate Komas' });
  await expect(generate).toBeInViewport({ ratio: 1 });
  await generate.click();
  await expect(conversation.getByText(/Created 3 Komas/)).toBeVisible();
  await expect(
    (await openCountChoices(window)).getByText('Replaces current Komas. Undo is available.'),
  ).toBeVisible();
  await window.keyboard.press('Escape');

  // Collapsing gives the canvas its space back and keeps focus in the prompt.
  const openCanvas = await getBox(canvas);
  await request.fill('An unsent request');
  await window.getByRole('button', { name: 'Hide the chat' }).click();
  await expect(conversation).toBeHidden();
  await expect(request).toBeFocused();
  await expect(request).toHaveValue('An unsent request');
  expect((await getBox(canvas)).height).toBeGreaterThan(openCanvas.height + 100);

  // Undo works from the canvas; the text field keeps its own undo.
  await window.getByRole('region', { name: 'Canvas' }).focus();
  await window.keyboard.press('Control+z');
  await expect(window.getByRole('button', { name: /^Koma 1:/ })).toHaveCount(0);
  await window.keyboard.press('Control+y');
  await expect(window.getByRole('button', { name: /^Koma 1:/ })).toHaveCount(1);
  await request.focus();
  await window.keyboard.type(' about bees');
  await window.keyboard.press('Control+z');
  await expect(window.getByRole('button', { name: /^Koma 1:/ })).toHaveCount(1);

  // Expanding again shows the same conversation and keeps the draft.
  await showChat(window);
  await expect(conversation.getByText(/Created 3 Komas/)).toBeVisible();
  await expect(request).toHaveValue(/An unsent request/);
  // Escape in the conversation collapses it again.
  await conversation.focus();
  await window.keyboard.press('Escape');
  await expect(conversation).toBeHidden();
  await expect(request).toBeFocused();
  expect(problems).toEqual([]);
});

test('keeps the canvas, prompt and filmstrip usable at the minimum window size', async () => {
  const { window, application, problems } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 700);
  });
  await window.getByRole('button', { name: 'Create a project' }).click();
  const { canvas, filmstrip } = getParts(window);

  await window.getByRole('button', { name: 'Use the example request' }).click();
  const generate = window.getByRole('button', { name: 'Generate Komas' });
  // Nearly 1: a fractional device scale factor can clip part of a pixel.
  await expect(generate).toBeInViewport({ ratio: 0.95 });
  await generate.click();
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
  await window.getByRole('button', { name: 'Hide the chat' }).click();

  const viewport = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const canvasBox = await getBox(canvas);
  expect(canvasBox.width).toBeGreaterThanOrEqual(400);
  expect(canvasBox.height).toBeGreaterThanOrEqual(240);
  await expect(filmstrip.getByRole('button', { name: 'Add Koma' })).toBeInViewport({ ratio: 1 });
  await expect(window.getByRole('button', { name: 'Share', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await expect(window.getByRole('button', { name: 'Zoom in' })).toBeInViewport({ ratio: 1 });

  // Playing opens the transition controls without pushing anything out of the window.
  await window.getByRole('button', { name: 'Play', exact: true }).click();
  const slider = window.getByLabel('Position in the transition');
  await expect(slider).toBeVisible();
  expect((await getBox(slider)).width).toBeGreaterThanOrEqual(96);
  await expect(window.getByLabel('Transition duration in seconds')).toBeInViewport({ ratio: 1 });
  await expect(filmstrip).toBeInViewport({ ratio: 1 });
  const stripBox = await getBox(filmstrip);
  expect(stripBox.y + stripBox.height).toBeLessThanOrEqual(viewport.height);
  await window.screenshot({ path: test.info().outputPath('prompt-minimum-playing.png') });
  await window.getByRole('button', { name: 'Stop preview', exact: true }).click();
  await expect(slider).toBeHidden();
  expect(problems).toEqual([]);
});

test('opens the Brand Kit over the canvas and pins properties beside it', async () => {
  const { window, application, problems } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await window.getByRole('button', { name: 'Use the example request' }).click();
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
  await window.getByRole('button', { name: 'Hide the chat' }).click();
  const { canvas } = getParts(window);
  const brandKitName = window.getByLabel('Brand name');
  for (const width of [1120, 1800]) {
    await application.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size, 800);
    }, width);
    // A floating panel leaves the canvas where it is.
    const canvasBefore = await getBox(canvas);
    await openBrandKit(window);
    await expect(brandKitName).toBeVisible();
    expect(await getBox(canvas)).toEqual(canvasBefore);
    await expect(window.getByRole('button', { name: 'Zoom in' })).toBeInViewport({ ratio: 1 });
    await window.getByRole('button', { name: 'Back to Inspector' }).click();
    await expect(
      window.getByRole('complementary', { name: 'Inspector', exact: true }),
    ).toBeVisible();

    // Pinning moves the panel beside the canvas and keeps its context.
    await window.getByRole('button', { name: 'Pin properties', exact: true }).click();
    await expect(
      window.getByRole('button', { name: 'Unpin properties', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    const pinnedCanvas = await getBox(canvas);
    const panel = await getBox(window.getByRole('region', { name: 'Properties', exact: true }));
    expect(pinnedCanvas.x + pinnedCanvas.width).toBeLessThanOrEqual(panel.x + 1);
    expect(pinnedCanvas.width).toBeGreaterThanOrEqual(420);
    // Escape does not close a pinned panel.
    await window.getByRole('region', { name: 'Properties', exact: true }).focus();
    await window.keyboard.press('Escape');
    await expect(
      window.getByRole('complementary', { name: 'Inspector', exact: true }),
    ).toBeVisible();
    await window.getByRole('button', { name: 'Unpin properties', exact: true }).click();
    await window.getByRole('button', { name: 'Close properties', exact: true }).click();
    await expect(window.getByRole('region', { name: 'Properties', exact: true })).toBeHidden();
  }

  // The pinned choice outlives a reload; the panel itself opens on request.
  await showInspector(window);
  await window.reload();
  await window.getByRole('button', { name: 'Create a project' }).click();
  await expect(window.getByRole('region', { name: 'Properties', exact: true })).toBeHidden();
  await window.getByRole('button', { name: 'Use the example request' }).click();
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
  await window.getByRole('button', { name: 'Properties', exact: true }).click();
  await expect(window.getByRole('button', { name: 'Unpin properties', exact: true })).toBeVisible();
  expect(problems).toEqual([]);
});
