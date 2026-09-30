import {
  createSeededIdGenerator,
  MAX_ELEMENTS_PER_KOMA,
  type KomaElement,
} from '@koma-motion/core';
import {
  buildKoma,
  buildPresentation,
  buildProject,
  buildShape,
  buildText,
} from '@koma-motion/core/testing';
import { syncTransitions } from '@koma-motion/motion-engine';
import { serialiseProject } from '@koma-motion/project-format';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  answerOpenDialog,
  answerSaveDialog,
  launchApplication,
  showInspector,
  type RunningApplication,
} from './application';

let running: RunningApplication;
test.beforeEach(async () => {
  running = await launchApplication();
});
test.afterEach(async () => {
  await running.close();
});

/** Saves a screenshot with the test output, and in `KOMA_EVIDENCE_DIR` when it is set. */
async function capture(window: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name);
  await window.screenshot({ path });
  const evidence = process.env['KOMA_EVIDENCE_DIR'];
  if (evidence !== undefined && evidence !== '') {
    await mkdir(evidence, { recursive: true });
    await copyFile(path, join(evidence, name));
  }
}

function sceneElements(): KomaElement[] {
  return [
    buildShape({
      id: 'backdrop',
      persistentId: 'backdrop',
      name: 'Backdrop',
      zIndex: 0,
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1080 },
      content: { shape: 'rectangle', cornerRadius: 0 },
      style: { fill: '#2B3A55', stroke: null, strokeWidth: 0 },
    }),
    buildShape({
      id: 'covered',
      persistentId: 'covered',
      name: 'Covered circle',
      zIndex: 1,
      position: { x: 300, y: 300 },
      size: { width: 200, height: 200 },
    }),
    buildShape({
      id: 'cover',
      persistentId: 'cover',
      name: 'Cover panel',
      zIndex: 2,
      position: { x: 250, y: 250 },
      size: { width: 400, height: 400 },
      content: { shape: 'rectangle', cornerRadius: 0 },
      style: { fill: '#F2C14E', stroke: null, strokeWidth: 0 },
    }),
    buildText({
      id: 'ghost',
      persistentId: 'ghost',
      name: 'Hidden note',
      zIndex: 3,
      visible: false,
      position: { x: 900, y: 200 },
    }),
    buildShape({
      id: 'badge',
      persistentId: 'badge',
      name: 'Corner badge',
      zIndex: 4,
      position: { x: 1800, y: 900 },
      size: { width: 300, height: 300 },
    }),
    buildText({
      id: 'headline',
      persistentId: 'headline',
      name: 'Headline',
      zIndex: 5,
      position: { x: 900, y: 600 },
    }),
  ];
}

async function openProject(elementsOfFirst: KomaElement[], withEmptyKoma: boolean): Promise<void> {
  const first = buildKoma({ id: 'koma-1', title: 'Scene', elements: elementsOfFirst });
  const second = buildKoma({
    id: 'koma-2',
    title: 'Scene again',
    elements: elementsOfFirst.map((element) => ({ ...element, id: `${element.id}-2` })),
  });
  const komas = withEmptyKoma
    ? [first, second, buildKoma({ id: 'koma-3', title: 'Empty', elements: [] })]
    : [first, second];
  const project = buildProject({
    name: 'Inspector',
    presentation: syncTransitions(
      buildPresentation({ komas, transitions: [] }),
      createSeededIdGenerator('inspector'),
    ).presentation,
  });
  const result = serialiseProject(project);
  if (!result.ok) throw new Error(result.error.message);
  const path = join(running.directory, 'inspector.koma');
  await writeFile(path, result.value);
  await answerOpenDialog(running.application, path);
  await running.window.getByRole('button', { name: 'Open a project', exact: true }).click();
  await expect(stage(running.window)).toBeVisible();
  await showInspector(running.window);
}

function stage(window: Page): ReturnType<Page['locator']> {
  return window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');
}

function inspector(window: Page): ReturnType<Page['getByRole']> {
  return window.getByRole('complementary', { name: 'Inspector' });
}

function layers(window: Page): ReturnType<Page['getByRole']> {
  return inspector(window).getByRole('list', { name: 'Layers of this Koma' });
}

function layer(window: Page, name: string): ReturnType<Page['getByRole']> {
  return layers(window).getByRole('button', { name: new RegExp(`^${name},`) });
}

async function expectTab(window: Page, name: 'Element' | 'Koma' | 'Motion'): Promise<void> {
  await expect(
    inspector(window).getByRole('tab', { name: new RegExp(`^${name}`) }),
  ).toHaveAttribute('aria-selected', 'true');
}

test('moves between Koma, element and motion contexts with the pointer and the keyboard', async () => {
  const testInfo = test.info();
  const { window } = running;
  await openProject(sceneElements(), true);

  // Nothing selected: the Koma and its actions.
  await expectTab(window, 'Koma');
  await expect(window.getByRole('heading', { name: 'Koma 1' })).toBeVisible();
  await expect(window.getByLabel('Title', { exact: true })).toHaveValue('Scene');
  await expect(window.getByRole('button', { name: 'New Koma after this one' })).toBeVisible();
  await capture(window, testInfo, 'inspector-koma.png');

  // A canvas selection opens the element with its type's controls first.
  await stage(window).getByRole('button', { name: 'Headline (text)', exact: true }).click();
  await expectTab(window, 'Element');
  await expect(window.getByRole('heading', { name: 'Selected element: Headline' })).toBeVisible();
  await expect(window.getByLabel('Text', { exact: true })).toBeVisible();
  await expect(window.getByLabel('X', { exact: true })).toHaveValue('900');
  await expect(layer(window, 'Headline')).toHaveAttribute('aria-pressed', 'true');

  // An ordinary field edit keeps the selection and the context.
  await window.getByLabel('Font size').fill('72');
  await expectTab(window, 'Element');
  await expect(stage(window).locator('[data-element-id="headline"]')).toHaveAttribute(
    'data-selected',
    'true',
  );
  await capture(window, testInfo, 'inspector-element-text.png');

  // A shape shows its fill first.
  await stage(window).getByRole('button', { name: 'Cover panel (shape)', exact: true }).click();
  await expect(window.getByLabel('Fill colour')).toHaveValue('#F2C14E');
  await window.getByLabel('Fill colour').fill('#12');
  await expect(window.getByText('Error: Use a hex colour such as #7CC4E8.')).toBeVisible();
  await window.getByLabel('Fill colour').fill('#123456');
  await expect(window.getByText(/Use a hex colour/)).toHaveCount(0);

  // The tabs work with the arrow keys; the Koma keeps its fields.
  const elementTab = inspector(window).getByRole('tab', { name: /^Element/ });
  await elementTab.focus();
  await window.keyboard.press('ArrowRight');
  await expectTab(window, 'Koma');
  await expect(inspector(window).getByRole('tab', { name: 'Koma' })).toBeFocused();
  await window.keyboard.press('ArrowRight');
  await expectTab(window, 'Motion');
  // The font size and fill edits above changed the Koma after its motion was worked out.
  await expect(window.getByRole('status', { name: 'Motion status' })).toContainText(
    'Motion is out of date',
  );
  await expect(window.getByLabel('Duration in seconds', { exact: true })).toHaveValue('0.9');
  await expect(window.getByLabel('Strategy')).toHaveValue('continuous');
  await expect(window.getByLabel('Easing')).toHaveValue('easeInOut');
  await expect(window.getByLabel('Why this motion')).toBeVisible();
  // The duration of the Inspector and of the transport are one setting.
  await window.getByLabel('Duration in seconds', { exact: true }).fill('2');
  await expect(window.getByLabel('Transition duration in seconds')).toHaveValue('2');
  await capture(window, testInfo, 'inspector-motion.png');

  // Home returns to the element, and choosing another Koma clears it.
  await inspector(window)
    .getByRole('tab', { name: /^Motion/ })
    .focus();
  await window.keyboard.press('Home');
  await expectTab(window, 'Element');
  await expect(
    window.getByRole('heading', { name: 'Selected element: Cover panel' }),
  ).toBeVisible();
  await window.getByRole('button', { name: 'Koma 2: Scene again' }).click();
  await expectTab(window, 'Koma');
  await expect(window.getByRole('heading', { name: 'Koma 2' })).toBeVisible();
  expect(running.problems).toEqual([]);
});

test('selects hidden, covered and off-canvas elements from Layers and changes their state', async () => {
  const testInfo = test.info();
  const { window, application } = running;
  await openProject(sceneElements(), true);

  // Frontmost first, with their state in words.
  const names = await layers(window)
    .getByRole('button', { name: /,/ })
    .evaluateAll((buttons) =>
      buttons
        .map((button) => button.getAttribute('aria-label') ?? '')
        .filter((label) => !/^(Hide|Show|Lock|Unlock) /.test(label)),
    );
  expect(names).toEqual([
    'Headline, Text',
    'Corner badge, Circle, partly off the canvas',
    'Hidden note, Text, hidden',
    'Cover panel, Rectangle',
    'Covered circle, Circle',
    'Backdrop, Rectangle',
  ]);

  // A hidden element is not on the canvas but can still be edited.
  await expect(stage(window).getByRole('button', { name: 'Hidden note (text)' })).toHaveCount(0);
  await layer(window, 'Hidden note').click();
  await expectTab(window, 'Element');
  await expect(window.getByText('Hidden', { exact: true })).toBeVisible();
  await expect(window.getByLabel('Text', { exact: true })).toBeEnabled();
  await layers(window).getByRole('button', { name: 'Show Hidden note' }).click();
  await expect(stage(window).getByRole('button', { name: 'Hidden note (text)' })).toBeVisible();
  await expect(stage(window).locator('[data-element-id="ghost"]')).toHaveAttribute(
    'data-selected',
    'true',
  );
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(stage(window).getByRole('button', { name: 'Hidden note (text)' })).toHaveCount(0);
  await expect(layer(window, 'Hidden note')).toHaveAttribute('aria-pressed', 'true');

  // A covered element is selected on the canvas and can be brought forward.
  await layer(window, 'Covered circle').click();
  await expect(stage(window).locator('[data-element-id="covered"]')).toHaveAttribute(
    'data-selected',
    'true',
  );
  await expect(window.getByText('Layer 5 of 6')).toBeVisible();
  await window.getByRole('button', { name: 'Bring forward' }).click();
  await expect(window.getByText('Layer 4 of 6')).toBeVisible();
  await expect(stage(window).locator('[data-element-id="covered"]')).toHaveCSS('z-index', '2');
  await expect(stage(window).locator('[data-element-id="cover"]')).toHaveCSS('z-index', '1');

  // The arrow keys move through the list and select as they go.
  await layer(window, 'Covered circle').focus();
  await window.keyboard.press('ArrowUp');
  await expect(layer(window, 'Hidden note')).toBeFocused();
  await expect(
    window.getByRole('heading', { name: 'Selected element: Hidden note' }),
  ).toBeVisible();
  await window.keyboard.press('End');
  await expect(layer(window, 'Backdrop')).toBeFocused();
  await expect(layer(window, 'Backdrop')).toHaveAttribute('aria-pressed', 'true');

  // Locking from the list protects the element from canvas and Inspector edits.
  await layers(window).getByRole('button', { name: 'Lock Corner badge' }).click();
  await expect(layer(window, 'Corner badge')).toHaveAccessibleName(
    'Corner badge, Circle, locked, partly off the canvas',
  );
  await layer(window, 'Corner badge').click();
  await expect(window.getByLabel('X', { exact: true })).toBeDisabled();
  await expect(window.getByRole('button', { name: 'Delete element' })).toBeDisabled();
  await expect(stage(window).getByRole('button', { name: /^Resize Corner badge/ })).toHaveCount(0);
  await capture(window, testInfo, 'inspector-layers.png');

  // Saved and reopened, the order and states remain.
  const path = join(running.directory, 'layers.koma');
  await answerSaveDialog(application, path);
  await window.getByRole('button', { name: 'Save as', exact: true }).click();
  await expect(window.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  await answerOpenDialog(application, path);
  await window.getByRole('button', { name: 'Open', exact: true }).click();
  await expectTab(window, 'Koma');
  await expect(layer(window, 'Corner badge')).toHaveAccessibleName(/locked/);
  await expect(layer(window, 'Covered circle')).toHaveAttribute('aria-pressed', 'false');
  await expect(stage(window).locator('[data-element-id="covered"]')).toHaveCSS('z-index', '2');
  expect(running.problems).toEqual([]);
});

test('deletes an element, clears its selection and restores it with Undo', async () => {
  const { window } = running;
  await openProject(sceneElements(), true);
  await layer(window, 'Headline').click();
  await window.getByRole('button', { name: 'Delete element' }).click();
  await expectTab(window, 'Koma');
  await expect(layer(window, 'Headline')).toHaveCount(0);
  await expect(stage(window).getByRole('button', { name: 'Headline (text)' })).toHaveCount(0);
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(layer(window, 'Headline')).toHaveAttribute('aria-pressed', 'false');
  await window.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(layer(window, 'Headline')).toHaveCount(0);

  // An empty Koma explains itself and offers an image.
  await window.getByRole('button', { name: 'Koma 3: Empty' }).click();
  await expect(inspector(window).getByText('This Koma has no elements yet.')).toBeVisible();
  await expect(inspector(window).getByRole('button', { name: 'Add an image' })).toBeEnabled();
});

test('reports out-of-date motion and recalculates it as one undoable step', async () => {
  const testInfo = test.info();
  const { window } = running;
  await openProject(sceneElements(), true);
  await stage(window).getByRole('button', { name: 'Headline (text)', exact: true }).click();
  await window.getByLabel('X', { exact: true }).fill('400');

  const motionTab = inspector(window).getByRole('tab', { name: /^Motion/ });
  await expect(motionTab).toHaveAccessibleName('Motion, needs attention');
  await motionTab.click();
  const status = window.getByRole('status', { name: 'Motion status' });
  await expect(status).toContainText('Motion is out of date');
  await expect(status).toContainText('Recalculate motion to preview again');
  await expect(window.getByRole('button', { name: 'Preview this transition' })).toHaveCount(0);
  await expect(window.getByRole('heading', { name: 'Stored effects (out of date)' })).toBeVisible();
  await capture(window, testInfo, 'inspector-motion-stale.png');

  await status.getByRole('button', { name: 'Recalculate motion' }).click();
  await expect(status).toContainText('Ready to play');
  await expect(motionTab).toHaveAccessibleName('Motion');
  await expect(window.getByRole('button', { name: 'Preview this transition' })).toBeVisible();
  await expect(
    window.getByRole('list', { name: 'What happens to each object' }).getByText('Headline'),
  ).toBeVisible();

  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(status).toContainText('Motion is out of date');
  await window.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(status).toContainText('Ready to play');

  // Previewing keeps the motion in view.
  await window.getByRole('button', { name: 'Preview this transition' }).click();
  await expectTab(window, 'Motion');
  await expect(stage(window)).toHaveAttribute('aria-label', /^Preview of the transition/);
  expect(running.problems).toEqual([]);
});

test('keeps a Koma at the element limit usable with paging and a filter', async () => {
  const testInfo = test.info();
  const { window } = running;
  const elements = Array.from({ length: MAX_ELEMENTS_PER_KOMA }, (_, index) => {
    const number = String(index + 1).padStart(4, '0');
    return buildShape({
      id: `item-${number}`,
      persistentId: `item-${number}`,
      name: `Item ${number}`,
      zIndex: -index,
      position: { x: (index % 40) * 48, y: Math.floor(index / 40) * 20 },
      size: { width: 40, height: 16 },
    });
  });
  await openProject(elements, false);
  const started = Date.now();
  await layer(window, 'Item 0001').click();
  await expect(layer(window, 'Item 0001')).toHaveAttribute('aria-pressed', 'true');
  const selectMs = Date.now() - started;

  const rows = layers(window).getByRole('listitem');
  await expect(rows).toHaveCount(100);
  await window.getByRole('button', { name: 'Show 100 more of 1900' }).click();
  await expect(rows).toHaveCount(200);

  await window.getByLabel('Filter layers').fill('item 1999');
  await expect(rows).toHaveCount(1);
  await layer(window, 'Item 1999').click();
  await expect(window.getByRole('heading', { name: 'Selected element: Item 1999' })).toBeVisible();
  await window.getByLabel('Filter layers').fill('nothing like this');
  await expect(inspector(window).getByText(/No layers match/)).toBeVisible();
  await window.getByRole('button', { name: 'Clear filter' }).click();
  // The selection stays listed even beyond the first page.
  await expect(layer(window, 'Item 1999')).toHaveAttribute('aria-pressed', 'true');
  await capture(window, testInfo, 'inspector-layers-limit.png');
  testInfo.annotations.push({
    type: 'measurement',
    description: `Selecting a layer among ${String(MAX_ELEMENTS_PER_KOMA)} elements took ${String(selectMs)} ms end to end`,
  });
  expect(running.problems).toEqual([]);
});

test('stays usable in a narrow window', async () => {
  const testInfo = test.info();
  const { window, application } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1120, 668);
  });
  await openProject(sceneElements(), true);
  await stage(window).getByRole('button', { name: 'Cover panel (shape)', exact: true }).click();

  const panel = inspector(window);
  const box = await panel.boundingBox();
  const viewport = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(box).not.toBeNull();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);
  // Tabs and layers stay on screen; the fields scroll between them.
  await expect(panel.getByRole('tablist')).toBeInViewport();
  await expect(panel.getByRole('button', { name: /^Layers/ })).toBeInViewport();
  const opacity = window.getByLabel('Opacity in percent');
  await opacity.scrollIntoViewIfNeeded();
  await expect(opacity).toBeInViewport();
  await opacity.fill('50');
  await expect(stage(window).locator('[data-element-id="cover"]')).toHaveCSS('opacity', '0.5');
  await expect(panel.getByRole('tablist')).toBeInViewport();

  // Folding Layers gives the fields the whole column.
  await panel.getByRole('button', { name: /^Layers/ }).click();
  await expect(layers(window)).toHaveCount(0);
  await panel.getByRole('button', { name: /^Layers/ }).click();
  await expect(layer(window, 'Cover panel')).toBeVisible();
  testInfo.annotations.push({
    type: 'window',
    description: `Viewport ${String(viewport.width)} x ${String(viewport.height)} CSS pixels`,
  });
  await capture(window, testInfo, 'inspector-narrow.png');
  expect(running.problems).toEqual([]);
});
