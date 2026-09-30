import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { komaProjectSchema } from '@koma-motion/core';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { answerSaveDialog, launchApplication, type RunningApplication } from './application';

let running: RunningApplication;

test.beforeEach(async () => {
  running = await launchApplication();
});

test.afterEach(async () => {
  await running.close();
});

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function getBox(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('The element has no visible bounds.');
  return box;
}

function getComposer(window: Page): {
  chat: Locator;
  provider: Locator;
  model: Locator;
  komas: Locator;
  auto: Locator;
  generate: Locator;
} {
  const chat = window.getByRole('region', { name: 'Agent chat' });
  return {
    chat,
    provider: chat.getByLabel('Provider', { exact: true }),
    model: chat.getByLabel('Model', { exact: true }),
    komas: chat.getByRole('spinbutton', { name: 'Komas', exact: true }),
    auto: chat.getByRole('button', { name: 'Auto', exact: true }),
    generate: chat.getByRole('button', { name: 'Generate Komas' }),
  };
}

/** Every control lies completely inside the chat, and Model and Komas share a row. */
async function expectComposerFits(window: Page): Promise<void> {
  const { chat, provider, model, komas, auto, generate } = getComposer(window);
  const chatBox = await getBox(chat);
  for (const control of [provider, model, komas, auto, generate]) {
    await control.scrollIntoViewIfNeeded();
    const box = await getBox(control);
    expect(box.width).toBeGreaterThanOrEqual(40);
    expect(box.x).toBeGreaterThanOrEqual(chatBox.x - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(chatBox.x + chatBox.width + 0.5);
  }
  const modelBox = await getBox(model);
  const komasBox = await getBox(komas);
  expect(Math.abs(modelBox.y - komasBox.y)).toBeLessThan(2);
  expect(modelBox.x + modelBox.width).toBeLessThanOrEqual(komasBox.x);
  expect(modelBox.width).toBeGreaterThanOrEqual(96);
}

test('chooses provider, model and Komas in the composer, without an audience', async () => {
  const { window, application, directory, problems } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  const { chat, provider, model, komas, auto, generate } = getComposer(window);

  // The canvas stays visible while prompting.
  await expect(window.getByRole('region', { name: 'Canvas' })).toBeVisible();
  await expect(chat.getByLabel('Your request')).toBeVisible();

  // Audience is gone; five Komas are offered first.
  await expect(window.getByText(/Audience/)).toHaveCount(0);
  await expect(komas).toHaveValue('5');
  await expect(auto).toHaveAttribute('aria-pressed', 'false');
  await expectComposerFits(window);

  // The mock provider has no model choice.
  await provider.selectOption('mock');
  await expect(model).toBeDisabled();
  await expect(model.locator('option:checked')).toHaveText('Default');

  // A CLI provider offers Default and the model id configured for it.
  await provider.selectOption('claude-code');
  await expect(model).toBeEnabled();
  await expect(model).toHaveValue('');
  await expect(model.locator('option')).toHaveText(['Default']);
  await window.getByRole('button', { name: 'Settings', exact: true }).click();
  await window.getByLabel('Model for Claude Code').fill('opus');
  await window.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(model).toHaveValue('opus');

  // Another provider shows its own model: nothing configured means Default.
  await provider.selectOption('codex');
  await expect(model).toHaveValue('');
  await expect(model.locator('option')).toHaveText(['Default']);
  await provider.selectOption('claude-code');
  await expect(model).toHaveValue('opus');

  // Default stays reversible: the model id remains offered, and Undo restores it.
  await model.selectOption('');
  await expect(model).toHaveValue('');
  await expect(model.locator('option')).toHaveText(['Default', 'opus']);
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(model).toHaveValue('opus');

  // Five Komas are requested from the mock, which always makes three.
  await provider.selectOption('mock');
  await chat.getByLabel('Your request').fill('Present the bee lifecycle to a school class.');
  await generate.click();
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
  await expect(
    window.getByText('Warning: 5 Komas were requested, the agent created 3.'),
  ).toBeVisible();

  // Auto leaves the number to the agent.
  await auto.click();
  await expect(auto).toHaveAttribute('aria-pressed', 'true');
  await expect(komas).toBeDisabled();
  await expect(komas).toHaveValue('');
  await chat.getByLabel('Your request').fill('Again, as the agent sees fit.');
  await generate.click();
  await expect(window.getByText(/Created 3 Komas/)).toHaveCount(2);
  await expect(window.getByText(/Komas were requested/)).toHaveCount(1);
  await auto.click();
  await expect(komas).toHaveValue('5');

  // The model is saved with the project. No audience was sent, so the mock used its own.
  const filePath = join(directory, 'composer.koma');
  await answerSaveDialog(application, filePath);
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('All changes saved')).toBeVisible();
  const saved = komaProjectSchema.parse(JSON.parse(await readFile(filePath, 'utf8')));
  expect(saved.agentConfiguration.selectedProviderId).toBe('mock');
  expect(saved.agentConfiguration.providers['claude-code']?.model).toBe('opus');
  expect(saved.presentation.audience).toBe('People who create presentations');

  // Interface preferences never hold project settings or the Koma count.
  await window.getByRole('button', { name: 'Hide the chat' }).click();
  const storage = await window.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(JSON.parse(storage)).toEqual({ 'koma-motion:chat': expect.any(String) });
  expect(storage).not.toContain('opus');
  expect(storage).not.toMatch(/count|model|provider/i);
  expect(problems).toEqual([]);
});

test('keeps model and Komas together at the narrowest chat and window', async () => {
  const { window, application, problems } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  const divider = window.getByRole('separator', { name: 'Resize the chat' });

  // The smallest chat the divider allows, then the widest.
  await divider.focus();
  await window.keyboard.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '300');
  await expectComposerFits(window);
  await window.keyboard.press('End');
  await expectComposerFits(window);

  // The minimum window size, and a smaller screen that clamps the window.
  for (const [width, height] of [
    [1120, 700],
    [1024, 655],
  ] as const) {
    await application.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height);
      },
      { width, height },
    );
    await divider.focus();
    await window.keyboard.press('Home');
    await expectComposerFits(window);
    await window.screenshot({ path: test.info().outputPath(`composer-${String(width)}.png`) });
  }

  // Keyboard: the choices are reachable in order after the request.
  const { provider, model, komas, auto } = getComposer(window);
  const chat = window.getByRole('region', { name: 'Agent chat' });
  const conversation = chat.getByRole('log', { name: 'Conversation' });
  const form = chat.locator('form');
  expect((await getBox(form)).height).toBeLessThan((await getBox(conversation)).height);
  await provider.selectOption('claude-code');
  await window.getByLabel('Your request').focus();
  await window.keyboard.press('Tab');
  // An empty request leaves Send disabled, so focus moves to Model.
  await expect(model).toBeFocused();
  await window.keyboard.press('Tab');
  await expect(komas).toBeFocused();
  await window.keyboard.press('Tab');
  await expect(auto).toBeFocused();
  await window.keyboard.press('Enter');
  await expect(auto).toHaveAttribute('aria-pressed', 'true');
  await window.keyboard.press('Tab');
  await expect(provider).toBeFocused();

  await provider.selectOption('mock');
  await window.getByLabel('Your request').fill('Present the motion engine.');
  await window.getByLabel('Your request').focus();
  await window.keyboard.press('Tab');
  await expect(window.getByRole('button', { name: 'Generate Komas' })).toBeFocused();

  // A long request grows within the dock without pushing the choices away.
  await window.getByLabel('Your request').fill('A detailed presentation brief. '.repeat(80));
  expect((await getBox(conversation)).height).toBeGreaterThan(100);
  await expect(provider).toBeInViewport({ ratio: 1 });
  await expect(window.getByRole('button', { name: 'Generate Komas' })).toBeInViewport({ ratio: 1 });
  expect(problems).toEqual([]);
});
