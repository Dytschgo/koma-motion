import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSeededIdGenerator } from '@koma-motion/core';
import { buildKoma, buildPresentation, buildProject, buildShape } from '@koma-motion/core/testing';
import { syncTransitions } from '@koma-motion/motion-engine';
import { serialiseProject } from '@koma-motion/project-format';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  answerOpenDialog,
  launchApplication,
  showChat,
  type RunningApplication,
} from './application';

/*
 * Acceptance for the approved "Quiet Stage" editor: canvas first, one thin
 * top bar, one prompt, the filmstrip with motion markers, a toolbar beside
 * the selection and properties on request. Captures go to the test output.
 */

let running: RunningApplication;

test.afterEach(async () => {
  await running.close();
});

async function box(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const bounds = await locator.boundingBox();
  if (bounds === null) throw new Error('The element has no visible bounds.');
  return bounds;
}

function stage(window: Page): Locator {
  return window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');
}

async function capture(window: Page, name: string): Promise<void> {
  await window.screenshot({ path: test.info().outputPath(`${name}.png`), scale: 'css' });
}

async function generateDemo(window: Page): Promise<void> {
  await window.getByRole('button', { name: 'Create a project' }).click();
  await window.getByRole('button', { name: 'Use the example request' }).click();
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
}

/** Two Komas with objects at the top-left corner and the right edge of the canvas. */
async function openEdgeProject(window: Page): Promise<void> {
  const corner = buildShape({
    id: 'corner-1',
    persistentId: 'corner',
    name: 'Corner',
    position: { x: 0, y: 0 },
    size: { width: 220, height: 160 },
  });
  const edge = buildShape({
    id: 'edge-1',
    persistentId: 'edge',
    name: 'Edge',
    position: { x: 1780, y: 820 },
    size: { width: 140, height: 140 },
    zIndex: 2,
  });
  const first = buildKoma({ id: 'koma-1', title: 'Edges', elements: [corner, edge] });
  const second = buildKoma({
    id: 'koma-2',
    title: 'Edges later',
    elements: [
      { ...corner, id: 'corner-2', position: { x: 300, y: 200 } },
      { ...edge, id: 'edge-2' },
    ],
  });
  const project = buildProject({
    name: 'Edge objects',
    presentation: syncTransitions(
      buildPresentation({ komas: [first, second], transitions: [] }),
      createSeededIdGenerator('quiet-stage'),
    ).presentation,
  });
  const encoded = serialiseProject(project);
  if (!encoded.ok) throw new Error(encoded.error.message);
  const path = join(running.directory, 'edges.koma');
  await writeFile(path, encoded.value);
  await answerOpenDialog(running.application, path);
  await window.getByRole('button', { name: 'Open a project', exact: true }).click();
  await expect(window.getByLabel('Project name')).toHaveValue('Edge objects');
}

test('opens canvas first with one thin bar, one prompt and the filmstrip at wide and minimum sizes', async () => {
  running = await launchApplication();
  const { window, application, problems } = running;
  await generateDemo(window);
  await window.getByRole('button', { name: 'Hide the chat', exact: true }).click();
  const header = window.getByRole('banner');
  for (const [width, height] of [
    [1480, 920],
    [1120, 700],
  ] as const) {
    await application.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
      },
      { width, height },
    );
    const viewport = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    // No permanent Koma column, chat dock or Inspector.
    await expect(window.getByRole('complementary', { name: 'Inspector' })).toHaveCount(0);
    await expect(window.getByRole('region', { name: 'Properties', exact: true })).toBeHidden();
    await expect(window.getByRole('log', { name: 'Conversation' })).toBeHidden();
    const canvas = await box(window.getByRole('region', { name: 'Canvas' }));
    expect(Math.abs(canvas.width - viewport.width)).toBeLessThanOrEqual(2);
    // One bar holds the project, history, adding, properties, playing and sharing.
    for (const name of [
      'Project menu',
      'Undo',
      'Redo',
      'Add element',
      'Properties',
      'Play',
      'Present or edit motion',
      'Share',
    ]) {
      await expect(header.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
    }
    expect((await box(header)).height).toBeLessThanOrEqual(60);
    // One prompt: request, scope and send; other choices stay folded away.
    const prompt = window.getByRole('region', { name: 'Agent chat' });
    await expect(prompt.getByLabel('Your request')).toBeVisible();
    await expect(prompt.getByLabel('Generation scope')).toHaveValue('entire');
    await expect(prompt.getByRole('button', { name: 'Generate Komas' })).toBeVisible();
    await expect(prompt.getByRole('group', { name: 'Generation choices' })).toBeHidden();
    // The filmstrip shows real thumbnails with the motion between them.
    const strip = window.getByRole('list', { name: 'Komas' });
    await expect(strip.getByRole('button', { name: /^Koma \d:/ })).toHaveCount(3);
    await expect(strip.getByRole('button', { name: /^Edit motion from Koma/ })).toHaveCount(2);
    await expect(strip.locator('[data-koma-thumbnail] [data-koma-stage]')).toHaveCount(3);
    const stripBox = await box(window.getByRole('region', { name: 'Filmstrip' }));
    expect(stripBox.y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1);
    expect(stripBox.y + stripBox.height).toBeLessThanOrEqual(viewport.height);
    // No transport band while nothing plays.
    await expect(window.getByRole('group', { name: 'Transition preview' })).toHaveCount(0);
    await capture(window, `default-${String(width)}`);
  }
  expect(problems).toEqual([]);
});

test('keeps the canvas fitted while chatting and tucks completed work away when editing resumes', async () => {
  running = await launchApplication();
  const { window, problems } = running;
  await generateDemo(window);
  const canvas = window.getByRole('region', { name: 'Canvas' });
  const log = window.getByRole('log', { name: 'Conversation' });
  const fitted = await box(canvas);
  await window.getByRole('button', { name: 'Hide the chat', exact: true }).click();
  expect(await box(canvas)).toEqual(fitted);
  await showChat(window);
  expect(await box(canvas)).toEqual(fitted);
  await window.getByLabel('Your request').fill('Keep this follow-up draft.');
  await canvas.locator('[data-koma-stage]').click({ position: { x: 20, y: 20 } });
  await expect(log).toBeHidden();
  await expect(window.getByLabel('Your request')).toHaveValue('Keep this follow-up draft.');
  await showChat(window);
  await expect(log.getByText(/Created 3 Komas/)).toBeVisible();
  expect(await box(canvas)).toEqual(fitted);
  await capture(window, 'conversation-over-canvas');
  await canvas.focus();
  await expect(log).toBeHidden();
  await expect(canvas).toBeFocused();
  expect(problems).toEqual([]);
});

test('keeps menus keyboard operable and returns focus when they close', async () => {
  running = await launchApplication();
  const { window, problems } = running;
  await generateDemo(window);
  const menuButton = window.getByRole('button', { name: 'Project menu', exact: true });
  await menuButton.focus();
  await window.keyboard.press('ArrowDown');
  const menu = window.getByRole('menu', { name: 'Project menu' });
  await expect(menu.getByRole('menuitem', { name: 'New', exact: true })).toBeFocused();
  for (const name of [
    'Open',
    'Save',
    'Brand Kit',
    'Instructions & templates',
    'Model',
    'Settings',
    'Project health',
    'Getting started',
  ]) {
    await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
  }
  await window.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Getting started', exact: true })).toBeFocused();
  const menuBox = await box(menu);
  const viewport = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height);
  await window.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(menuButton).toBeFocused();

  // Share offers export and a copy; the Play menu offers presenting and motion timing.
  const share = window.getByRole('button', { name: 'Share', exact: true });
  await share.focus();
  await window.keyboard.press('Enter');
  const shareMenu = window.getByRole('menu', { name: 'Share' });
  await expect(shareMenu.getByRole('menuitem', { name: 'Export PowerPoint' })).toBeFocused();
  await expect(shareMenu.getByRole('menuitem', { name: 'Save as', exact: true })).toBeEnabled();
  const shareBox = await box(shareMenu);
  expect(shareBox.x + shareBox.width).toBeLessThanOrEqual(viewport.width);
  await window.keyboard.press('Escape');
  await expect(share).toBeFocused();
  await window.getByRole('button', { name: 'Present or edit motion', exact: true }).click();
  const playMenu = window.getByRole('menu', { name: 'Present or edit motion' });
  await expect(playMenu.getByRole('menuitem', { name: 'Edit motion' })).toBeEnabled();
  await expect(
    playMenu.getByRole('menuitem', { name: 'Present from the beginning' }),
  ).toBeEnabled();
  await playMenu.getByRole('menuitem', { name: 'Edit motion' }).click();
  // Editing motion shows the timing without starting playback.
  const transport = window.getByRole('group', { name: 'Transition preview' });
  await expect(transport).toBeVisible();
  await expect(stage(window)).toHaveAttribute('aria-label', /^Koma 1:/);
  await expect(transport.getByLabel('Transition duration in seconds')).toBeVisible();
  await window.getByRole('button', { name: 'Stop preview', exact: true }).click();
  await expect(transport).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('places the object toolbar inside the canvas for edge objects and edits through it', async () => {
  running = await launchApplication();
  const { window, problems } = running;
  await openEdgeProject(window);
  const desk = await box(window.getByRole('region', { name: 'Canvas' }));
  const toolbar = window.getByRole('toolbar', { name: 'Element actions' });

  // An object at the top-left corner gets its toolbar below it, inside the canvas.
  const corner = stage(window).getByRole('button', { name: 'Corner (shape)', exact: true });
  await corner.click();
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveAttribute('data-side', 'below');
  const cornerBox = await box(corner);
  let toolbarBox = await box(toolbar);
  expect(toolbarBox.x).toBeGreaterThanOrEqual(desk.x);
  expect(toolbarBox.y).toBeGreaterThanOrEqual(cornerBox.y + cornerBox.height - 1);
  expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(desk.x + desk.width);
  for (const name of ['Fill colour', 'Size and position', 'Arrange', 'Motion', 'More']) {
    await expect(toolbar.getByRole('button', { name, exact: true })).toBeVisible();
  }
  // The toolbar does not cover the object it acts on.
  expect(toolbarBox.y).toBeGreaterThanOrEqual(cornerBox.y + cornerBox.height - 1);

  // An object at the right edge keeps its whole toolbar on screen.
  const edge = stage(window).getByRole('button', { name: 'Edge (shape)', exact: true });
  await edge.click();
  toolbarBox = await box(toolbar);
  expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(desk.x + desk.width);
  await expect(toolbar).toHaveAttribute('data-side', 'above');
  await capture(window, 'selection-edge-toolbar');

  // Colour: a Brand Kit swatch recolours the object, as one undoable step.
  await toolbar.getByRole('button', { name: 'Fill colour', exact: true }).click();
  const colour = window.getByRole('dialog', { name: 'Colour' });
  const swatch = colour.getByRole('button', { name: /^Use accent colour/ });
  const hex = (await swatch.getAttribute('aria-label'))?.split(' ').at(-1) ?? '';
  expect(hex).toMatch(/^#[0-9A-F]{6}$/i);
  await swatch.click();
  await expect(stage(window).locator('[data-persistent-id="edge"] ellipse')).toHaveAttribute(
    'fill',
    hex,
  );
  await window.keyboard.press('Escape');
  await expect(colour).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: 'Fill colour', exact: true })).toBeFocused();

  // Size and position: exact values without opening the full properties.
  await toolbar.getByRole('button', { name: 'Size and position', exact: true }).click();
  const size = window.getByRole('dialog', { name: 'Size and position' });
  await size.getByLabel('Width', { exact: true }).fill('120');
  await size.getByLabel('Width', { exact: true }).press('Tab');
  await window.keyboard.press('Escape');
  await expect(size).toHaveCount(0);

  // Arrange: the corner object comes to the front.
  await corner.click();
  await toolbar.getByRole('button', { name: 'Arrange', exact: true }).click();
  await window.getByRole('menuitem', { name: 'Bring to front', exact: true }).click();

  // More > Properties shows every value, which can be pinned beside the canvas.
  await toolbar.getByRole('button', { name: 'More', exact: true }).click();
  await window.getByRole('menuitem', { name: 'Properties', exact: true }).click();
  const inspector = window.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector.getByRole('heading', { name: 'Selected element: Corner' })).toBeVisible();
  await window.getByRole('button', { name: 'Pin properties', exact: true }).click();
  await expect(inspector).toBeVisible();
  const pinned = await box(window.getByRole('region', { name: 'Properties', exact: true }));
  const pinnedCanvas = await box(window.getByRole('region', { name: 'Canvas' }));
  expect(pinnedCanvas.x + pinnedCanvas.width).toBeLessThanOrEqual(pinned.x + 1);
  await edge.click();
  await expect(inspector.getByRole('heading', { name: 'Selected element: Edge' })).toBeVisible();
  await expect(inspector.getByLabel('Width', { exact: true })).toHaveValue('120');
  await capture(window, 'pinned-properties');

  // Colour, size and stacking were three separate undo steps.
  const undo = window.getByRole('button', { name: 'Undo', exact: true });
  for (let step = 0; step < 3; step += 1) await undo.click();
  await expect(inspector.getByLabel('Width', { exact: true })).toHaveValue('140');
  expect(problems).toEqual([]);
});

test('opens motion from a marker between thumbnails with keyboard and pointer', async () => {
  running = await launchApplication();
  const { window, problems } = running;
  await openEdgeProject(window);
  const marker = window
    .getByRole('list', { name: 'Komas' })
    .getByRole('button', { name: 'Edit motion from Koma 1 to Koma 2', exact: true });
  await window.getByRole('button', { name: 'Koma 2: Edges later', exact: true }).focus();
  await window.keyboard.press('Shift+Tab');
  await expect(marker).toBeFocused();
  await window.keyboard.press('Enter');
  const transport = window.getByRole('group', { name: 'Transition preview' });
  await expect(transport).toContainText('Koma 1 to Koma 2');
  await expect(marker).toHaveAttribute('aria-current', 'true');
  // Opening a motion is an editing action; Play starts it separately.
  await expect(transport.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await expect(
    window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]'),
  ).toHaveAttribute('aria-label', 'Koma 1: Edges');
  await transport.getByLabel('Transition duration in seconds').fill('2');
  await expect(transport.getByLabel('Transition duration in seconds')).toHaveValue('2');
  await capture(window, 'motion-marker-open');
  await transport.getByRole('button', { name: 'Motion details', exact: true }).click();
  await expect(window.getByRole('tab', { name: /^Motion/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(problems).toEqual([]);
});

test('expands the prompt into the conversation and keeps a failed request where it was made', async () => {
  running = await launchApplication({
    env: { KOMA_MOCK_DELAY_MS: '600', KOMA_MOCK_OUTCOME: 'invalid' },
  });
  const { window, problems } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  const request = window.getByLabel('Your request');
  await request.fill('Create a short deck about tides.');
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  const log = window.getByRole('log', { name: 'Conversation' });
  await expect(log.getByText('Couldn’t use the result. Nothing changed.')).toBeVisible({
    timeout: 20_000,
  });
  await expect(window.getByRole('list', { name: 'Komas' })).toHaveCount(0);
  await window.getByRole('region', { name: 'Canvas' }).click({ position: { x: 20, y: 20 } });
  await expect(log).toBeVisible();

  // Collapsed, the prompt itself carries the failure, with Recheck.
  await window.getByRole('button', { name: 'Hide the chat', exact: true }).click();
  const failure = window
    .getByRole('region', { name: 'Agent chat' })
    .getByRole('alert')
    .filter({ hasText: 'Couldn’t use the result. Nothing changed.' });
  await expect(failure).toBeVisible();
  await capture(window, 'failure-prompt');
  // A new draft survives rechecking the original request.
  await request.fill('A follow-up I have not sent.');
  await failure.getByRole('button', { name: 'Recheck', exact: true }).click();
  await expect(window.getByRole('button', { name: 'Stop generating' })).toBeVisible();
  await expect(request).toHaveValue('A follow-up I have not sent.');
  await expect(log.getByText(/You asked:/)).toHaveCount(2);
  await expect(log.getByText('You asked: Create a short deck about tides.')).toHaveCount(2);
  await expect(log.getByText('Couldn’t use the result. Nothing changed.')).toHaveCount(2, {
    timeout: 20_000,
  });
  await expect(request).toHaveValue('A follow-up I have not sent.');
  // Details opens the conversation at the failure.
  await window.getByRole('button', { name: 'Hide the chat', exact: true }).click();
  await failure.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(log).toBeVisible();
  expect(problems).toEqual([]);
});

test('reviews a selected-Koma proposal from the expanded prompt', async () => {
  running = await launchApplication({ env: { KOMA_MOCK_DELAY_MS: '300' } });
  const { window, problems } = running;
  await generateDemo(window);
  await window.getByRole('button', { name: 'Hide the chat', exact: true }).click();
  await window.getByRole('button', { name: 'Koma 2: The motion engine', exact: true }).click();
  const scope = window.getByLabel('Generation scope');
  await scope.selectOption('selected');
  // The scope names its target instead of a generic phrase.
  await expect(scope.locator('option:checked')).toHaveText('Koma 2');
  await window.getByLabel('Your request').fill('Refine this Koma.');
  await window.getByRole('button', { name: 'Generate Komas', exact: true }).click();
  const proposal = window.getByRole('region', { name: 'Selected Koma proposal' });
  await expect(proposal).toBeVisible();
  await expect(scope).toBeDisabled();
  await showChat(window);
  await capture(window, 'proposal-review');
  await proposal.getByRole('button', { name: 'Discard proposal' }).click();
  await expect(
    window.getByRole('button', { name: 'Koma 2: The motion engine', exact: true }),
  ).toBeVisible();
  expect(problems).toEqual([]);
});
