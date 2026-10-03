import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { komaProjectSchema } from '@koma-motion/core';
import type { ProviderModelListing } from '@koma-motion/agent-runtime';
import {
  launchApplication,
  answerOpenDialog,
  answerSaveDialog,
  type RunningApplication,
} from './application';
import { modelTrigger, openModelChoices } from './composerControls';
import { mockModelDiscovery } from './modelFixtures';

const catalog: ProviderModelListing = {
  status: 'listed',
  checkedAt: '2026-10-03T12:00:00Z',
  defaultModel: null,
  models: [
    {
      id: 'fixture-opus',
      label: 'Claude Opus 5.5',
      reasoning: {
        status: 'supported',
        choices: ['low', 'medium', 'high'].map((value) => ({ value, label: value })),
        defaultValue: null,
      },
    },
    {
      id: 'fixture-sonnet',
      label: 'Claude Sonnet 5.3',
      reasoning: {
        status: 'supported',
        choices: [{ value: 'careful-v2', label: 'Careful' }],
        defaultValue: 'careful-v2',
      },
    },
    { id: 'fixture-haiku', label: 'Claude Haiku 4.5', reasoning: { status: 'unsupported' } },
  ],
};
const fixtures = {
  'claude-code': catalog,
  codex: { status: 'unsupported' } as const,
  grok: { status: 'failed', message: 'Fixture is offline. Try again.' } as const,
};
let running: RunningApplication;
test.beforeEach(async () => {
  running = await launchApplication();
  await mockModelDiscovery(running.application, fixtures);
});
test.afterEach(async () => {
  await running.close();
});

test('expands only supported models, keeps native radio keys, and saves model-specific effort', async () => {
  const info = test.info();
  const { window, application, directory, problems } = running;
  await window.emulateMedia({ reducedMotion: 'reduce' });
  await window.getByRole('button', { name: 'Create a project' }).click();
  let picker = await openModelChoices(window);
  await picker.locator('[data-model-value="fixture-opus"]').click();
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('radio')).toHaveCount(3);
  await picker.getByRole('radio', { name: 'medium', exact: true }).check();
  await window.keyboard.press('ArrowRight');
  await expect(picker.getByRole('radio', { name: 'high', exact: true })).toBeChecked();
  await expect(picker.getByRole('radio', { name: 'high', exact: true })).toBeFocused();
  await window.keyboard.press('ArrowLeft');
  await expect(picker.getByRole('radio', { name: 'medium', exact: true })).toBeChecked();
  await picker.screenshot({ path: info.outputPath('model-chooser-selected.png'), scale: 'css' });
  await picker.locator('[data-model-value="fixture-sonnet"]').click();
  await expect(picker.getByRole('radio')).toHaveCount(1);
  await expect(picker.getByRole('radio', { name: 'Careful' })).not.toBeChecked();
  await picker.getByRole('radio', { name: 'Careful' }).check();
  await picker.locator('[data-model-value="fixture-opus"]').click();
  await expect(picker.getByRole('radio', { name: 'medium', exact: true })).toBeChecked();
  await picker.getByRole('button', { name: 'Pin Claude Opus 5.5 · Claude Code' }).click();
  await expect(picker.getByRole('searchbox')).toBeFocused();
  await window.keyboard.press('Escape');
  await expect(modelTrigger(window)).toBeFocused();
  // One undo affects just the last reasoning edit (favorites never edit the project).
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await window.getByRole('button', { name: 'Redo', exact: true }).click();
  const path = join(directory, 'reasoning.koma');
  await answerSaveDialog(application, path);
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('All changes saved')).toBeVisible();
  await expect
    .poll(
      async () =>
        komaProjectSchema.parse(JSON.parse(await readFile(path, 'utf8'))).agentConfiguration
          .providers['claude-code']?.reasoningByModel,
    )
    .toEqual({ 'fixture-opus': 'medium', 'fixture-sonnet': 'careful-v2' });
  await window.reload();
  await answerOpenDialog(application, path);
  await window.getByRole('button', { name: 'Open a project', exact: true }).click();
  picker = await openModelChoices(window);
  await expect(picker.getByRole('radio', { name: 'medium', exact: true })).toBeChecked();
  await picker.getByRole('button', { name: 'Use CLI default reasoning' }).click();
  await expect(picker.getByRole('radio', { checked: true })).toHaveCount(0);
  await picker.locator('[data-model-value="fixture-haiku"]').click();
  picker = await openModelChoices(window);
  await expect(picker.getByRole('radio')).toHaveCount(0);
  await expect(
    picker.getByText('This CLI reports no selectable reasoning choices for this model.'),
  ).toBeVisible();
  expect(problems).toEqual([]);
});

test('replaces old capability snapshots on loading and failure, and explains removed preferences', async () => {
  const info = test.info();
  const { window, application } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  const picker = await openModelChoices(window);
  await picker.locator('[data-model-value="fixture-opus"]').click();
  await picker.getByRole('radio', { name: 'high', exact: true }).check();
  await mockModelDiscovery(
    application,
    {
      ...fixtures,
      'claude-code': { status: 'failed', message: 'Capabilities unavailable. Retry.' },
    },
    500,
  );
  await picker.getByRole('button', { name: 'Refresh models from Claude Code' }).click();
  await expect(picker.getByText(/Checking saved reasoning/)).toBeVisible();
  await expect(picker.getByRole('radio')).toHaveCount(0);
  await expect(
    picker.getByText('Saved reasoning “high” is unverified.', { exact: false }),
  ).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Retry models from Claude Code' })).toBeEnabled();
  await picker.screenshot({ path: info.outputPath('model-chooser-failed.png'), scale: 'css' });
  await mockModelDiscovery(application, {
    ...fixtures,
    'claude-code': {
      ...catalog,
      models: catalog.models.map((model) =>
        model.id === 'fixture-opus'
          ? {
              ...model,
              reasoning: {
                status: 'supported',
                choices: [{ value: 'new-depth', label: 'New depth' }],
                defaultValue: null,
              },
            }
          : model,
      ),
    },
  });
  await picker.getByRole('button', { name: 'Retry models from Claude Code' }).click();
  await expect(picker.getByRole('radio', { name: 'New depth' })).toBeVisible();
  await expect(picker.getByRole('radio')).toHaveCount(1);
  await expect(picker.getByText(/is no longer reported for this model/)).toBeVisible();
  await picker.getByRole('button', { name: 'Use CLI default reasoning' }).click();
  await expect(picker.getByText(/is no longer reported/)).toHaveCount(0);
  await expect(picker.getByText(/Capability discovery unsupported/)).toBeVisible();
  await picker.getByRole('button', { name: 'Model options', exact: true }).click();
  await expect(picker.getByLabel('Provider', { exact: true })).toBeFocused();
  await expect(picker.getByLabel('Model', { exact: true })).toBeVisible();
});

test('keeps reasoning, tabs and image controls usable in a 300px chat', async () => {
  const info = test.info();
  const { window, application, problems } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 700);
  });
  await window.getByRole('separator', { name: 'Resize the chat' }).focus();
  await window.keyboard.press('Home');
  const picker = await openModelChoices(window);
  await picker.locator('[data-model-value="fixture-opus"]').click();
  await picker.getByRole('radio', { name: 'medium', exact: true }).check();
  await expect(picker).toBeInViewport({ ratio: 1 });
  expect(await picker.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await picker.screenshot({ path: info.outputPath('model-chooser-narrow.png'), scale: 'css' });
  await picker.getByRole('tab', { name: 'Text', exact: true }).focus();
  await window.keyboard.press('ArrowRight');
  await expect(picker.getByRole('tab', { name: /^Images/ })).toBeFocused();
  await expect(picker.getByRole('tab', { name: /^Images/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(picker.getByRole('button', { name: /Codex/ }).first()).toBeVisible();
  await window.keyboard.press('ArrowLeft');
  await expect(picker.getByRole('radio', { name: 'medium', exact: true })).toBeChecked();
  await window.keyboard.press('Escape');
  await expect(modelTrigger(window)).toBeFocused();
  expect(problems).toEqual([]);
});
