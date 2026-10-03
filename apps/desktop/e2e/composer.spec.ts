import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { komaProjectSchema } from '@koma-motion/core';
import { buildKoma, buildPresentation, buildProject, buildShape } from '@koma-motion/core/testing';
import { getStarterPreset } from '@koma-motion/brand-kit';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  answerSaveDialog,
  answerOpenDialog,
  showChat,
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
  selectProvider,
} from './composerControls';

let running: RunningApplication;
test.beforeEach(async () => {
  running = await launchApplication();
});
test.afterEach(async () => {
  await running.close();
});

test('retains selected draft/count through narrow Inspect collapse and edits, then clears them on same-file reopen', async () => {
  const { window, application, directory } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1024, 700);
  });
  const fixture = buildProject({
    name: 'Composer session',
    presentation: buildPresentation({
      komas: [
        buildKoma({ id: 'first', title: 'First', elements: [buildShape({ name: 'Object' })] }),
      ],
      transitions: [],
    }),
  });
  const path = join(directory, 'composer-session.koma');
  const original = JSON.stringify(fixture);
  await writeFile(path, original);
  await answerOpenDialog(application, path);
  await window.getByRole('button', { name: 'Open', exact: true }).click();
  await showChat(window);
  const counts = await openCountChoices(window);
  await counts.getByRole('spinbutton', { name: 'Komas' }).fill('6');
  await counts.getByRole('spinbutton', { name: 'Komas' }).press('Enter');
  const request = window.getByLabel('Your request');
  await request.pressSequentially('A selected draft with spaces');
  await window.getByLabel('Generation scope').selectOption('selected');
  await window
    .getByRole('region', { name: 'Canvas' })
    .getByRole('button', { name: 'Object (shape)' })
    .click();
  await window.getByRole('button', { name: 'Inspect selected element' }).click();
  await expect(request).toBeHidden();
  await expect(window.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
  await window.getByRole('button', { name: 'Show the chat', exact: true }).click();
  await expect(request).toBeFocused();
  await expect(request).toHaveValue('A selected draft with spaces');
  await expect(window.getByLabel('Generation scope')).toHaveValue('selected');
  await expect(countTrigger(window)).toBeDisabled();
  await window.getByLabel('Generation scope').selectOption('entire');
  await expect(countTrigger(window)).toHaveAttribute('aria-description', '6 Komas');
  await window.getByLabel('Project name').fill('An edit in the same session');
  await window.getByLabel('Project name').blur();
  await expect(request).toHaveValue('A selected draft with spaces');
  await window.getByLabel('Generation scope').selectOption('selected');
  await answerOpenDialog(application, path);
  await window.getByRole('button', { name: 'Open', exact: true }).click();
  await window.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(window.getByLabel('Project name')).toHaveValue('Composer session');
  await showChat(window);
  await expect(request).toHaveValue('');
  await expect(window.getByLabel('Generation scope')).toHaveValue('entire');
  await expect(countTrigger(window)).toHaveAttribute('aria-description', '5 Komas');
  expect(await readFile(path, 'utf8')).toBe(original);
  await window.screenshot({ path: test.info().outputPath('composer-session-reset.png') });
  expect(running.problems).toEqual([]);
});

test('starter seeds replace an unsent request/count without being cleared by session initialization', async () => {
  const { window } = running;
  const starter = getStarterPreset('solar-system');
  await window
    .getByRole('list', { name: 'Starters' })
    .getByRole('button', { name: 'Start Solar system' })
    .click();
  await showChat(window);
  await expect(window.getByLabel('Your request')).toHaveValue(starter.request);
  await expect(countTrigger(window)).toHaveAttribute(
    'aria-description',
    `${String(starter.komaCount)} Komas`,
  );
  await window.getByLabel('Your request').fill('An unsent request before choosing another starter');
  const counts = await openCountChoices(window);
  await counts.getByRole('spinbutton', { name: 'Komas' }).fill('4');
  await counts.getByRole('spinbutton', { name: 'Komas' }).press('Enter');
  await openSettingsPage(window, 'Templates');
  await window
    .getByRole('list', { name: 'Starters' })
    .getByRole('button', { name: 'Apply Rapunzel story' })
    .click();
  await showChat(window);
  const next = getStarterPreset('rapunzel');
  await expect(window.getByLabel('Your request')).toHaveValue(next.request);
  await expect(countTrigger(window)).toHaveAttribute(
    'aria-description',
    `${String(next.komaCount)} Komas`,
  );
  expect(running.problems).toEqual([]);
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
  const model = modelTrigger(page);
  const count = countTrigger(page);
  const brand = page.getByRole('button', { name: 'Choose Brand Kit', exact: true });
  const send = page.getByRole('button', { name: 'Generate Komas' });
  for (const control of [model, brand, count, send]) {
    const bounds = await box(control);
    expect(bounds.width).toBeGreaterThanOrEqual(32);
    expect(bounds.x).toBeGreaterThanOrEqual(chatBox.x - 0.5);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(chatBox.x + chatBox.width + 0.5);
  }
  const modelBox = await box(model);
  const brandBox = await box(brand);
  expect(Math.abs(modelBox.y - brandBox.y)).toBeLessThan(2);
  expect(modelBox.x + modelBox.width).toBeLessThanOrEqual(brandBox.x);
  for (const openChoices of [openProviderChoices, openModelChoices, openCountChoices]) {
    const dialog = await openChoices(page);
    const bounds = await box(dialog);
    expect(bounds.x).toBeGreaterThanOrEqual(chatBox.x - 0.5);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(chatBox.x + chatBox.width + 0.5);
    await page.keyboard.press('Escape');
  }
}

test('preserves model defaults, custom IDs, undo and project settings through model options', async () => {
  const { window, application, directory, problems } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await expect(window.getByText(/Audience/)).toHaveCount(0);
  await expect(countTrigger(window)).toHaveAttribute('aria-description', '5 Komas');
  await expect(modelTrigger(window)).toHaveAttribute(
    'aria-description',
    'Mock provider has no model choice',
  );
  await expectChoicesFit(window);

  let choices = await openProviderChoices(window);
  const provider = choices.getByLabel('Provider', { exact: true });
  await expect(provider).toHaveValue('mock');
  await expect(choices.getByText('Demo only · 3 Komas')).toBeVisible();
  let models = await openProviderChoices(window);
  await expect(models.getByLabel('Model', { exact: true })).toBeDisabled();
  choices = await openProviderChoices(window);
  await choices.getByLabel('Provider', { exact: true }).selectOption('claude-code');
  await expect(choices.getByText(/^Claude Code sends your request.*online\.$/)).toBeVisible();
  await modelTrigger(window).click();

  // Before a run, the footer names the model that will run.
  await expect(modelTrigger(window)).toHaveAttribute(
    'aria-description',
    'Next run uses the default model of Claude Code',
  );
  await expect(modelTrigger(window)).toHaveText('Claude Code · Default');
  models = await openProviderChoices(window);
  const model = models.getByLabel('Model', { exact: true });
  await expect(model).toBeEnabled();
  await expect(model).toHaveValue('');
  expect(
    await model
      .locator('optgroup')
      .evaluateAll((groups) => groups.map((group) => group.getAttribute('label'))),
  ).toEqual(['Reported by the CLI']);
  await expect(model.locator('option[value="opus"]')).toHaveCount(1);
  await expect(model.locator('option[value="claude-opus-5-5"]')).toHaveCount(1);
  await expect(
    models.getByText(/Models and reasoning choices reported by Claude Code/),
  ).toBeVisible();
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
    'Next run uses claude-opus-5-5[1m], not in the latest CLI list',
  );
  await expect(model).toHaveValue('claude-opus-5-5[1m]');
  // An entered model stays in the list after choosing Default.
  await model.selectOption('');
  await expect(modelTrigger(window)).toHaveText('Claude Code · Default');
  await expect(model.locator('option[value="claude-opus-5-5[1m]"]')).toHaveCount(1);
  await modelTrigger(window).click();

  // Settings shows the same choice for the project.
  await openSettingsPage(window, 'Generation');
  const settingsModel = window.getByLabel('Model for Claude Code', { exact: true });
  await expect(settingsModel).toHaveValue('');
  await chooseModel(window, 'Model for Claude Code', 'opus');
  await window.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(modelTrigger(window)).toHaveText('Opus (latest)');

  // Each provider keeps its own model.
  await selectProvider(window, 'codex');
  await expect(modelTrigger(window)).toHaveText('Codex CLI · Default');
  await selectProvider(window, 'claude-code');
  await expect(modelTrigger(window)).toHaveText('Opus (latest)');
  models = await openProviderChoices(window);
  await models.getByLabel('Model', { exact: true }).selectOption('');
  await expect(modelTrigger(window)).toHaveText('Claude Code · Default');
  await window.keyboard.press('Escape');
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(modelTrigger(window)).toHaveText('Opus (latest)');

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
  await expect(window.getByRole('button', { name: 'Attach references' })).toBeFocused();
  await modelTrigger(window).focus();
  await window.keyboard.press('Enter');
  await expect(
    (await openProviderChoices(window)).getByLabel('Provider', { exact: true }),
  ).toBeFocused();
  await window.keyboard.press('Escape');
  await expect(modelTrigger(window)).toBeFocused();
  await modelTrigger(window).focus();
  await expect(modelTrigger(window)).toBeFocused();
  await window.keyboard.press('Tab');
  await expect(window.getByRole('button', { name: 'Choose Brand Kit', exact: true })).toBeFocused();
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
  await expect(modelTrigger(window)).toBeInViewport({ ratio: 1 });
  await expect(countTrigger(window)).toBeInViewport({ ratio: 1 });
  await expect(window.getByRole('button', { name: 'Generate Komas' })).toBeInViewport({ ratio: 1 });

  await modelTrigger(window).click();
  const longRequestPicker = window.getByRole('dialog', { name: 'Model', exact: true });
  const headerBox = await box(chat.getByTestId('chat-header'));
  expect((await box(longRequestPicker)).y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
  await window.getByRole('button', { name: 'Hide the chat' }).click();
  await window.getByRole('button', { name: 'Show the chat' }).click();
  await expect(window.getByRole('dialog', { name: 'Model', exact: true })).toHaveCount(0);
  await modelTrigger(window).click();
  await window.getByRole('button', { name: 'New', exact: true }).click();
  await expect(window.getByRole('dialog', { name: 'Model', exact: true })).toHaveCount(0);
  expect(problems).toEqual([]);
});
