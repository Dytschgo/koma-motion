import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import {
  answerOpenDialog,
  answerSaveDialog,
  launchApplication,
  type RunningApplication,
} from './application';

const REQUEST =
  'Create a three-frame presentation introducing Koma Motion. Start with the complete system, focus on the motion engine, then reveal how it exports an editable presentation.';

let running: RunningApplication;

test.beforeEach(async () => {
  running = await launchApplication();
});

test.afterEach(async () => {
  await running.close();
});

/** The canvas in the middle of the window, not the thumbnails. */
function getStage(): Locator {
  return running.window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');
}

/** Position of the motion engine on the canvas, in CSS pixels. */
async function getEnginePosition(): Promise<{ x: number; width: number }> {
  const box = await getStage().locator('[data-persistent-id="motion-engine"]').boundingBox();
  if (box === null) {
    throw new Error('The motion engine is not on the canvas');
  }
  return { x: box.x, width: box.width };
}

test('creates, generates, previews, saves and reopens a presentation', async () => {
  const { window, application, directory, problems } = running;
  const filePath = join(directory, 'introduction.koma');

  await test.step('start the application', async () => {
    await expect(window.getByRole('heading', { name: /Presentations are frames/ })).toBeVisible();
    expect(await application.evaluate(({ app }) => app.getName())).toBeTruthy();
  });

  await test.step('create a project', async () => {
    await window.getByRole('button', { name: 'Create a project' }).click();
    await expect(window.getByLabel('Project name')).toHaveValue('Untitled project');
    await window.getByLabel('Project name').fill('Introduction');
    await expect(window.getByText('Unsaved changes')).toBeVisible();
  });

  await test.step('configure the Brand Kit', async () => {
    await window.getByRole('button', { name: 'Brand Kit' }).click();
    await window.getByLabel('Brand name').fill('Koma Motion');
    await window.getByLabel('Primary colour').fill('#e4572e');

    await window.getByLabel('Accent colour').fill('sunshine');
    await expect(window.getByText(/"sunshine" is not a valid hex colour/)).toBeVisible();
    await window.getByLabel('Accent colour').fill('#FFC914');
    await expect(window.getByText(/not a valid hex colour/)).toHaveCount(0);

    await window.getByRole('button', { name: 'Back to the canvas' }).click();
  });

  await test.step('select the mock provider', async () => {
    const provider = window.getByLabel('Provider');
    await provider.selectOption('mock');
    await expect(provider).toHaveValue('mock');
    await expect(window.getByText(/Available: Built in/)).toBeVisible();
  });

  await test.step('submit a generation request and receive three Komas', async () => {
    await window.getByLabel('Your request').fill(REQUEST);
    await window.getByRole('button', { name: 'Generate Komas' }).click();
    await expect(window.getByRole('button', { name: 'Cancel' })).toBeVisible();

    const komas = window.getByRole('list', { name: 'Komas' });
    await expect(komas.getByRole('button', { name: /^Koma \d:/ })).toHaveCount(3);
    await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
    await expect(komas.getByRole('button', { name: /^Preview the transition/ })).toHaveCount(2);
  });

  await test.step('generated Komas use the Brand Kit', async () => {
    await expect(getStage()).toHaveAttribute('aria-label', 'Koma 1: One connected system');
    const engine = getStage().locator('[data-persistent-id="motion-engine"] ellipse');
    await expect(engine).toHaveAttribute('fill', '#E4572E');
  });

  await test.step('select the second Koma and inspect an element', async () => {
    await window.getByRole('button', { name: 'Koma 2: The motion engine' }).click();
    await expect(window.getByRole('heading', { name: 'Koma 2' })).toBeVisible();
    await expect(window.getByLabel('Title', { exact: true })).toHaveValue('The motion engine');

    await getStage().getByRole('button', { name: 'Motion engine (shape)' }).click();
    await expect(window.getByRole('heading', { name: 'Selected element' })).toBeVisible();
    await expect(window.getByText('motion-engine', { exact: true })).toBeVisible();
    await expect(window.getByLabel('Width')).toHaveValue('400');
  });

  await test.step('preview the transition between the first two Komas', async () => {
    await window.getByRole('button', { name: 'Koma 1: One connected system' }).click();
    const atRest = await getEnginePosition();

    // A long transition leaves time to look at a frame in the middle of it.
    await window.getByLabel('Transition duration in seconds').fill('4');
    await window.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(window.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect(getStage()).toHaveAttribute(
      'aria-label',
      'Preview of the transition from One connected system to The motion engine',
    );

    await expect
      .poll(async () => (await getEnginePosition()).x, { timeout: 4000 })
      .toBeLessThan(atRest.x - 5);
    await window.getByRole('button', { name: 'Pause' }).click();
    const between = await getEnginePosition();
    expect(between.width).toBeGreaterThan(atRest.width);

    await window.getByRole('button', { name: 'Play' }).click();
    // The preview ends on the second Koma.
    await expect(getStage()).toHaveAttribute('aria-label', 'Koma 2: The motion engine', {
      timeout: 8000,
    });
    const arrived = await getEnginePosition();
    expect(arrived.width).toBeGreaterThan(between.width);
    expect(arrived.width / atRest.width).toBeCloseTo(2, 1);
  });

  await test.step('save the project', async () => {
    await answerSaveDialog(application, filePath);
    await window.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(window.getByText('All changes saved')).toBeVisible();
    await expect(window.getByText('introduction.koma', { exact: true })).toBeVisible();

    const saved: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    expect(saved).toMatchObject({
      format: 'koma-motion-project',
      schemaVersion: 1,
      name: 'Introduction',
      brandKit: { name: 'Koma Motion', colours: { primary: '#E4572E', accent: '#FFC914' } },
      presentation: { title: 'Koma Motion' },
      generationHistory: [{ providerId: 'mock', status: 'succeeded' }],
    });
  });

  await test.step('reopen the project without losing content', async () => {
    const saved = await readFile(filePath, 'utf8');

    await window.getByRole('button', { name: 'New', exact: true }).click();
    await expect(window.getByRole('list', { name: 'Komas' })).toHaveCount(0);

    await answerOpenDialog(application, filePath);
    await window.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(window.getByLabel('Project name')).toHaveValue('Introduction');
    await expect(
      window.getByRole('list', { name: 'Komas' }).getByRole('button', { name: /^Koma \d:/ }),
    ).toHaveCount(3);
    await expect(window.getByText('All changes saved')).toBeVisible();

    // Saving the reopened project writes the same content again.
    await window.getByLabel('Project name').fill('Introduction ');
    await window.getByLabel('Project name').fill('Introduction');
    await window.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(window.getByText('All changes saved')).toBeVisible();
    const withoutTime = (text: string): string => text.replace(/"updatedAt": "[^"]+"/, '');
    expect(withoutTime(await readFile(filePath, 'utf8'))).toBe(withoutTime(saved));
  });

  expect(problems).toEqual([]);
});

test('keeps the presentation when a generation is cancelled', async () => {
  const { window } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await window.getByLabel('Your request').fill(REQUEST);
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  await window.getByRole('button', { name: 'Cancel' }).click();

  await expect(window.getByText('Generation stopped')).toBeVisible();
  await expect(window.getByText('Your presentation was not changed.')).toBeVisible();
  await expect(window.getByRole('list', { name: 'Komas' })).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

test('saves unsaved changes when the window is closed', async () => {
  const { window, application, directory } = running;
  const filePath = join(directory, 'closing.koma');
  await window.getByRole('button', { name: 'Create a project' }).click();
  await window.getByLabel('Project name').fill('Saved while closing');
  await expect(window.getByText('Unsaved changes')).toBeVisible();

  // The user chooses "Save" in the question about unsaved changes.
  await answerSaveDialog(application, filePath);
  await application.evaluate(({ dialog }) => {
    dialog.showMessageBox = () => Promise.resolve({ response: 0, checkboxChecked: false });
  });
  const closed = application.waitForEvent('close');
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
  });
  await closed;

  const saved: unknown = JSON.parse(await readFile(filePath, 'utf8'));
  expect(saved).toMatchObject({ name: 'Saved while closing' });
});

test('keeps the window open when closing is cancelled', async () => {
  const { window, application } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await window.getByLabel('Project name').fill('Still editing');

  await application.evaluate(({ dialog }) => {
    dialog.showMessageBox = () => Promise.resolve({ response: 2, checkboxChecked: false });
  });
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
  });

  await expect(window.getByLabel('Project name')).toHaveValue('Still editing');
  expect(
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
  ).toBe(1);
});

test('explains why a file cannot be opened', async () => {
  const { window, application, directory } = running;
  const filePath = join(directory, 'future.koma');
  await writeFile(
    filePath,
    JSON.stringify({ format: 'koma-motion-project', schemaVersion: 99 }),
    'utf8',
  );

  await answerOpenDialog(application, filePath);
  await window.getByRole('button', { name: 'Open a project' }).click();

  await expect(window.getByRole('alert')).toContainText('format version 99');
  await expect(window.getByRole('alert')).toContainText('Update Koma Motion');
  await expect(window.getByRole('heading', { name: /Presentations are frames/ })).toBeVisible();
});

test('isolates the window from Node.js and from the network', async () => {
  const { window } = running;

  const exposed = await window.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>)['require'],
    process: typeof (globalThis as Record<string, unknown>)['process'],
    bridge: Object.keys((globalThis as Record<string, unknown>)['komaMotion'] ?? {}).sort(),
  }));
  expect(exposed).toEqual({
    require: 'undefined',
    process: 'undefined',
    bridge: ['invoke', 'subscribe'],
  });

  const unknownChannel = await window.evaluate(async () => {
    const bridge = (globalThis as Record<string, unknown>)['komaMotion'] as {
      invoke(channel: string, request: unknown): Promise<unknown>;
    };
    try {
      await bridge.invoke('koma:shell:execute', { command: 'whoami' });
      return 'accepted';
    } catch {
      return 'rejected';
    }
  });
  expect(unknownChannel).toBe('rejected');

  const invalidPayload = await window.evaluate(async () => {
    const bridge = (globalThis as Record<string, unknown>)['komaMotion'] as {
      invoke(channel: string, request: unknown): Promise<unknown>;
    };
    try {
      await bridge.invoke('koma:project:save', { project: {}, filePath: 'C:/anywhere.koma' });
      return 'accepted';
    } catch {
      return 'rejected';
    }
  });
  expect(invalidPayload).toBe('rejected');

  const network = await window.evaluate(async () => {
    try {
      await fetch('https://example.com/');
      return 'reached';
    } catch {
      return 'blocked';
    }
  });
  expect(network).toBe('blocked');
});
