import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { komaProjectSchema } from '@koma-motion/core';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  answerSaveDialog,
  launchApplication,
  type RunningApplication,
  openSettingsPage,
} from './application';
import {
  chooseModel,
  countTrigger,
  modelTrigger,
  openCountChoices,
  openModelChoices,
  openProviderChoices,
  providerTrigger,
  selectProvider,
} from './composerControls';

let running: RunningApplication;
test.beforeEach(async () => {
  running = await launchApplication();
});
test.afterEach(async () => {
  await running.close();
});

async function box(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const bounds = await locator.boundingBox();
  if (bounds === null) throw new Error('Control has no visible bounds.');
  return bounds;
}

async function expectChoicesFit(page: Page): Promise<void> {
  const chat = page.getByRole('region', { name: 'Agent chat' });
  const chatBox = await box(chat);
  const provider = providerTrigger(page);
  const model = modelTrigger(page);
  const count = countTrigger(page);
  const send = page.getByRole('button', { name: 'Generate Komas' });
  for (const control of [provider, model, count, send]) {
    const bounds = await box(control);
    expect(bounds.width).toBeGreaterThanOrEqual(40);
    expect(bounds.x).toBeGreaterThanOrEqual(chatBox.x - 0.5);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(chatBox.x + chatBox.width + 0.5);
  }
  const providerBox = await box(provider);
  const modelBox = await box(model);
  const countBox = await box(count);
  expect(Math.abs(providerBox.y - countBox.y)).toBeLessThan(2);
  expect(Math.abs(modelBox.y - countBox.y)).toBeLessThan(2);
  // Provider, then model, then the Koma count, side by side.
  expect(providerBox.x + providerBox.width).toBeLessThanOrEqual(modelBox.x);
  expect(modelBox.x + modelBox.width).toBeLessThanOrEqual(countBox.x);
  for (const openChoices of [openProviderChoices, openModelChoices, openCountChoices]) {
    const dialog = await openChoices(page);
    const bounds = await box(dialog);
    expect(bounds.x).toBeGreaterThanOrEqual(chatBox.x - 0.5);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(chatBox.x + chatBox.width + 0.5);
    await page.keyboard.press('Escape');
  }
}

test('chooses provider, model and Komas from the compact footer without an audience', async () => {
  const { window, application, directory, problems } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await expect(window.getByText(/Audience/)).toHaveCount(0);
  await expect(countTrigger(window)).toHaveAttribute('aria-description', '5 Komas');
  await expect(providerTrigger(window)).toHaveAttribute('aria-description', 'Mock provider');
  await expect(modelTrigger(window)).toHaveAttribute(
    'aria-description',
    'Mock provider has no model choice',
  );
  await expectChoicesFit(window);

  let choices = await openProviderChoices(window);
  const provider = choices.getByLabel('Provider', { exact: true });
  await expect(provider).toHaveValue('mock');
  await expect(choices.getByText('Demo only · 3 Komas')).toBeVisible();
  let models = await openModelChoices(window);
  await expect(models.getByLabel('Model', { exact: true })).toBeDisabled();
  choices = await openProviderChoices(window);
  await choices.getByLabel('Provider', { exact: true }).selectOption('claude-code');
  await expect(choices.getByText(/^Claude Code sends your request.*online\.$/)).toBeVisible();
  await providerTrigger(window).click();

  // Before a run, the footer names the model that will run.
  await expect(modelTrigger(window)).toHaveAttribute(
    'aria-description',
    'Next run uses the default model of Claude Code',
  );
  await expect(modelTrigger(window)).toHaveText('Default model');
  models = await openModelChoices(window);
  const model = models.getByLabel('Model', { exact: true });
  await expect(model).toBeEnabled();
  await expect(model).toHaveValue('');
  expect(
    await model
      .locator('optgroup')
      .evaluateAll((groups) => groups.map((group) => group.getAttribute('label'))),
  ).toEqual(['Aliases', 'Model names']);
  await expect(model.locator('option[value="opus"]')).toHaveCount(1);
  await expect(model.locator('option[value="claude-opus-5-5"]')).toHaveCount(1);
  await expect(models.getByText(/cannot list the models of your sign-in/)).toBeVisible();
  await model.selectOption('opus');
  await expect(modelTrigger(window)).toHaveAttribute('aria-description', 'Next run uses opus');

  // An invalid model id is explained and not stored.
  await model.selectOption('__custom__');
  const custom = models.getByLabel('Model id', { exact: true });
  await custom.fill('two words');
  await expect(models.getByRole('alert')).toContainText('without spaces');
  await expect(models.getByRole('button', { name: 'Use' })).toBeDisabled();
  await custom.press('Enter');
  await expect(modelTrigger(window)).toHaveAttribute('aria-description', 'Next run uses opus');
  await custom.fill('claude-opus-5-5[1m]');
  await custom.press('Enter');
  await expect(modelTrigger(window)).toHaveAttribute(
    'aria-description',
    'Next run uses claude-opus-5-5[1m]',
  );
  await expect(model).toHaveValue('claude-opus-5-5[1m]');
  // An entered model stays in the list after choosing Default.
  await model.selectOption('');
  await expect(modelTrigger(window)).toHaveText('Default model');
  await expect(model.locator('option[value="claude-opus-5-5[1m]"]')).toHaveCount(1);
  await providerTrigger(window).click();

  // Settings shows the same choice for the project.
  await openSettingsPage(window, 'Generation');
  const settingsModel = window.getByLabel('Model for Claude Code', { exact: true });
  await expect(settingsModel).toHaveValue('');
  await chooseModel(window, 'Model for Claude Code', 'opus');
  await window.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(modelTrigger(window)).toHaveText('opus');

  // Each provider keeps its own model.
  await selectProvider(window, 'codex');
  await expect(modelTrigger(window)).toHaveText('Default model');
  await selectProvider(window, 'claude-code');
  await expect(modelTrigger(window)).toHaveText('opus');
  models = await openModelChoices(window);
  await models.getByLabel('Model', { exact: true }).selectOption('');
  await expect(modelTrigger(window)).toHaveText('Default model');
  await window.keyboard.press('Escape');
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(modelTrigger(window)).toHaveText('opus');

  await selectProvider(window, 'mock');
  await window.getByLabel('Your request').fill('Present the bee lifecycle to a school class.');
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
  await expect(
    window.getByText('Warning: 5 Komas were requested, the agent created 3.'),
  ).toBeVisible();
  const countChoices = await openCountChoices(window);
  await expect(countChoices.getByText('Replaces current Komas. Undo is available.')).toBeVisible();
  await countChoices.getByRole('button', { name: 'Auto' }).click();
  await expect(countChoices.getByRole('spinbutton', { name: 'Komas' })).toBeDisabled();
  await window.keyboard.press('Escape');
  await expect(countTrigger(window)).toHaveAttribute('aria-description', 'Automatic Koma count');
  await window.getByLabel('Your request').fill('Again, as the agent sees fit.');
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  await expect(window.getByText(/Created 3 Komas/)).toHaveCount(2);
  await expect(window.getByText(/Komas were requested/)).toHaveCount(1);
  const autoChoices = await openCountChoices(window);
  await autoChoices.getByRole('button', { name: 'Auto' }).click();
  await window.keyboard.press('Escape');
  await expect(countTrigger(window)).toHaveAttribute('aria-description', '5 Komas');

  const filePath = join(directory, 'composer.koma');
  await answerSaveDialog(application, filePath);
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('All changes saved')).toBeVisible();
  const saved = komaProjectSchema.parse(JSON.parse(await readFile(filePath, 'utf8')));
  expect(saved.agentConfiguration.selectedProviderId).toBe('mock');
  expect(saved.agentConfiguration.providers['claude-code']?.model).toBe('opus');
  expect(saved.presentation.audience).toBe('People who create presentations');
  await window.getByRole('button', { name: 'Hide the chat' }).click();
  const storage = await window.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(JSON.parse(storage)).toEqual({ 'koma-motion:chat': expect.any(String) });
  expect(storage).not.toMatch(/opus|count|model|provider/i);
  expect(problems).toEqual([]);
});

test('keeps both pickers usable at 300 pixels, including invalid count and keyboard dismissal', async () => {
  const { window, application, problems } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  const divider = window.getByRole('separator', { name: 'Resize the chat' });
  for (const [width, height] of [
    [1120, 700],
    [1024, 655],
  ] as const) {
    await application.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
      },
      { width, height },
    );
    await divider.focus();
    await window.keyboard.press('Home');
    await expect(divider).toHaveAttribute('aria-valuenow', '300');
    await expectChoicesFit(window);
  }

  const chat = window.getByRole('region', { name: 'Agent chat' });
  expect((await box(chat.locator('form'))).height).toBeLessThan(
    (await box(chat.getByRole('log', { name: 'Conversation' }))).height,
  );
  await window.getByLabel('Your request').focus();
  await window.keyboard.press('Tab');
  await expect(providerTrigger(window)).toBeFocused();
  await window.keyboard.press('Enter');
  await expect(
    (await openProviderChoices(window)).getByLabel('Provider', { exact: true }),
  ).toBeFocused();
  await window.keyboard.press('Escape');
  await expect(providerTrigger(window)).toBeFocused();
  await window.keyboard.press('Tab');
  await expect(modelTrigger(window)).toBeFocused();
  await window.keyboard.press('Tab');
  await expect(countTrigger(window)).toBeFocused();
  await window.keyboard.press('Enter');
  const choices = await openCountChoices(window);
  const input = choices.getByRole('spinbutton', { name: 'Komas' });
  await expect(input).toBeFocused();
  await input.fill('');
  await input.press('Escape');
  await expect(countTrigger(window)).toHaveAttribute('aria-invalid', 'true');
  await expect(countTrigger(window)).toContainText('Set Komas');
  await window.getByLabel('Your request').fill('Show three stages.');
  await expect(window.getByRole('button', { name: 'Generate Komas' })).toBeDisabled();
  const repair = await openCountChoices(window);
  await repair.getByRole('spinbutton', { name: 'Komas' }).fill('6');
  await repair.getByRole('spinbutton', { name: 'Komas' }).press('Enter');
  await expect(countTrigger(window)).toHaveAttribute('aria-description', '6 Komas');
  await expect(window.getByRole('button', { name: 'Generate Komas' })).toBeEnabled();
  await expect(window.getByRole('log', { name: 'Conversation' }).locator('li')).toHaveCount(0);
  const keyboardChoices = await openCountChoices(window);
  const autoButton = keyboardChoices.getByRole('button', { name: 'Auto' });
  await autoButton.focus();
  await autoButton.press('Enter');
  await expect(countTrigger(window)).toHaveAttribute('aria-description', 'Automatic Koma count');
  await expect(keyboardChoices).toBeVisible();
  await autoButton.press('Enter');
  await expect(countTrigger(window)).toHaveAttribute('aria-description', '6 Komas');
  await expect(window.getByRole('log', { name: 'Conversation' }).locator('li')).toHaveCount(0);
  await window.keyboard.press('Escape');
  await countTrigger(window).click();
  await window.getByLabel('Your request').click();
  await expect(window.getByRole('dialog', { name: 'Koma count' })).toHaveCount(0);
  await expect(window.getByLabel('Your request')).toBeFocused();

  await window.getByLabel('Your request').fill('A detailed presentation brief. '.repeat(80));
  expect((await box(chat.getByRole('log', { name: 'Conversation' }))).height).toBeGreaterThan(100);
  await expect(providerTrigger(window)).toBeInViewport({ ratio: 1 });
  await expect(countTrigger(window)).toBeInViewport({ ratio: 1 });
  await expect(window.getByRole('button', { name: 'Generate Komas' })).toBeInViewport({ ratio: 1 });

  await providerTrigger(window).click();
  await window.getByRole('button', { name: 'Hide the chat' }).click();
  await window.getByRole('button', { name: 'Show the chat' }).click();
  await expect(window.getByRole('dialog', { name: 'Provider', exact: true })).toHaveCount(0);
  await providerTrigger(window).click();
  await window.getByRole('button', { name: 'New', exact: true }).click();
  await expect(window.getByRole('dialog', { name: 'Provider', exact: true })).toHaveCount(0);
  expect(problems).toEqual([]);
});
