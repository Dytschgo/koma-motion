import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchApplication, type RunningApplication } from './application';

let running: RunningApplication;

test.beforeEach(async () => {
  running = await launchApplication();
});

test.afterEach(async () => {
  await running.close();
});

function stage(): Locator {
  return running.window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');
}

function positionSlider(page: Page): Locator {
  return page.getByLabel('Position in the transition');
}

async function createGeneratedProject(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Provider').selectOption('mock');
  await expect(page.getByLabel('Provider')).toHaveValue('mock');
  await page.getByRole('button', { name: 'Use the example request' }).click();
  await page.getByRole('button', { name: 'Generate Komas' }).click();
  await expect(
    page.getByRole('list', { name: 'Komas' }).getByRole('button', { name: /^Koma \d:/ }),
  ).toHaveCount(3);
}

/** The slider is 0–1000. `percent` 50 sets the accessible value to 50 percent. */
async function setPosition(page: Page, percent: number): Promise<void> {
  const slider = positionSlider(page);
  await slider.fill(String(percent * 10));
  await expect(slider).toHaveAttribute('aria-valuetext', `${String(percent)} percent`);
}

test('resets a scrubbed preview when undo removes its transition', async () => {
  const { window } = running;
  await createGeneratedProject(window);
  await window.getByRole('button', { name: 'Koma 3: Motion you can edit' }).click();
  await window.getByRole('button', { name: 'Add Koma' }).click();
  await expect(window.getByRole('button', { name: 'Koma 4: Koma 4' })).toHaveAttribute(
    'aria-current',
    'true',
  );

  await setPosition(window, 50);
  await expect(stage()).toHaveAttribute(
    'aria-label',
    'Preview of the transition from Motion you can edit to Koma 4',
  );

  const slider = positionSlider(window);
  await slider.focus();
  await expect(slider).toBeFocused();
  await window.keyboard.press('Control+z');

  await expect(stage()).toHaveAttribute('aria-label', 'Koma 1: One connected system');
  await expect(stage()).not.toHaveAttribute('aria-label', /Preview of the transition/);
  await expect(slider).toHaveAttribute('aria-valuetext', '0 percent');
  await expect(slider).toBeFocused();
  await expect(window.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
  expect(running.problems).toEqual([]);
});

test('pauses at the scrubbed position instead of restarting', async () => {
  const { window } = running;
  await createGeneratedProject(window);
  await window.getByLabel('Transition duration in seconds').fill('4');
  await window.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(window.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  await setPosition(window, 50);

  await expect(window.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(window.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
  await expect(positionSlider(window)).toHaveAttribute('aria-valuetext', '50 percent');
  await expect(stage()).toHaveAttribute(
    'aria-label',
    'Preview of the transition from One connected system to The motion engine',
  );
  expect(running.problems).toEqual([]);
});

test('keeps the scrub position across a duration edit and its undo', async () => {
  const { window } = running;
  await createGeneratedProject(window);
  await window.getByRole('button', { name: 'Koma 3: Motion you can edit' }).click();
  await window.getByRole('button', { name: 'Add Koma' }).click();
  await setPosition(window, 40);
  const previewLabel = 'Preview of the transition from Motion you can edit to Koma 4';
  await expect(stage()).toHaveAttribute('aria-label', previewLabel);

  await window.getByLabel('Transition duration in seconds').fill('4');
  await expect(positionSlider(window)).toHaveAttribute('aria-valuetext', '40 percent');
  await expect(stage()).toHaveAttribute('aria-label', previewLabel);
  await expect(window.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

  const undo = window.getByRole('button', { name: 'Undo' });
  const redo = window.getByRole('button', { name: 'Redo' });
  await undo.click();
  await expect(window.getByLabel('Transition duration in seconds')).toHaveValue('0.9');
  await expect(positionSlider(window)).toHaveAttribute('aria-valuetext', '40 percent');
  await expect(stage()).toHaveAttribute('aria-label', previewLabel);

  await redo.click();
  await expect(window.getByLabel('Transition duration in seconds')).toHaveValue('4');
  await expect(positionSlider(window)).toHaveAttribute('aria-valuetext', '40 percent');
  await expect(stage()).toHaveAttribute('aria-label', previewLabel);

  await undo.click();
  await expect(positionSlider(window)).toHaveAttribute('aria-valuetext', '40 percent');
  await undo.click();
  await expect(stage()).toHaveAttribute('aria-label', 'Koma 1: One connected system');
  await expect(stage()).not.toHaveAttribute('aria-label', /Preview of the transition/);
  await expect(positionSlider(window)).toHaveAttribute('aria-valuetext', '0 percent');
  expect(running.problems).toEqual([]);
});

test('resets the preview when the pair is moved or deleted', async () => {
  const { window } = running;
  await createGeneratedProject(window);
  await setPosition(window, 50);
  await expect(stage()).toHaveAttribute(
    'aria-label',
    'Preview of the transition from One connected system to The motion engine',
  );

  await window.getByRole('button', { name: 'Move Koma down' }).click();
  await expect(stage()).toHaveAttribute('aria-label', 'Koma 2: One connected system');
  await expect(stage()).not.toHaveAttribute('aria-label', /Preview of the transition/);
  await expect(positionSlider(window)).toHaveAttribute('aria-valuetext', '0 percent');

  await setPosition(window, 50);
  await expect(stage()).toHaveAttribute('aria-label', /Preview of the transition/);
  await window.getByRole('button', { name: 'Delete Koma', exact: true }).click();
  await window.getByRole('dialog').getByRole('button', { name: 'Delete Koma' }).click();
  await expect(stage()).not.toHaveAttribute('aria-label', /Preview of the transition/);
  await expect(positionSlider(window)).toHaveAttribute('aria-valuetext', '0 percent');
  expect(running.problems).toEqual([]);
});

test('resets an invalid preview when reduced motion is emulated', async () => {
  const { window } = running;
  // Playwright media emulation, not the operating-system reduced-motion setting.
  await window.emulateMedia({ reducedMotion: 'reduce' });
  await createGeneratedProject(window);
  await expect(window.getByText(/Reduced motion is on/)).toBeVisible();

  await window.getByRole('button', { name: 'Koma 3: Motion you can edit' }).click();
  await window.getByRole('button', { name: 'Add Koma' }).click();
  await setPosition(window, 50);
  await expect(stage()).toHaveAttribute(
    'aria-label',
    'Preview of the transition from Motion you can edit to Koma 4',
  );
  await window.getByRole('button', { name: 'Undo' }).click();
  await expect(stage()).toHaveAttribute('aria-label', 'Koma 1: One connected system');
  await expect(stage()).not.toHaveAttribute('aria-label', /Preview of the transition/);
  await expect(positionSlider(window)).toHaveAttribute('aria-valuetext', '0 percent');
  await expect(window.getByText(/Reduced motion is on/)).toBeVisible();
  expect(running.problems).toEqual([]);
});
