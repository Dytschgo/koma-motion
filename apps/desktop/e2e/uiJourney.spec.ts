import { readFile, stat, writeFile } from 'node:fs/promises';
import { komaProjectSchema } from '@koma-motion/core';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  answerSaveDialog,
  launchApplication,
  openSettingsPage,
  showChat,
  type RunningApplication,
} from './application';
import { countTrigger, openProviderChoices } from './composerControls';

let running: RunningApplication;
test.beforeEach(async () => {
  running = await launchApplication({ env: { KOMA_MOCK_DELAY_MS: '100' } });
});
test.afterEach(async () => {
  await running.close();
});

async function create() {
  await running.window.getByRole('button', { name: 'Create a project' }).click();
}
async function demo() {
  await create();
  await running.window.getByRole('button', { name: 'Use the example request' }).click();
  await running.window.getByRole('button', { name: 'Generate Komas', exact: true }).click();
  await expect(running.window.getByText(/Created 3 Komas/)).toBeVisible();
}

test('the title-bar name stays editable with thumbnails collapsed and saves independently of the filename', async () => {
  await demo();
  const { window, application, directory } = running;
  const header = window.getByRole('banner');
  const name = header.getByLabel('Project name', { exact: true });
  await window.getByRole('button', { name: 'Hide Koma thumbnails', exact: true }).click();
  await name.fill('');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(header.getByRole('alert')).toContainText('A project needs a name');
  await name.fill('A clear title');
  await name.press('Tab');
  await expect(header.getByRole('alert')).toHaveCount(0);
  await header.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(name).toHaveValue('Untitled project');
  await header.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(name).toHaveValue('A clear title');
  const path = join(directory, 'different-filename.koma');
  await answerSaveDialog(application, path);
  await header.getByRole('button', { name: 'Save as', exact: true }).click();
  await expect(header.getByText('All changes saved', { exact: true })).toBeVisible();
  await expect(header.getByText('different-filename.koma', { exact: true })).toBeVisible();
  expect(komaProjectSchema.parse(JSON.parse(await readFile(path, 'utf8'))).name).toBe(
    'A clear title',
  );
  await window.getByRole('button', { name: 'Show Koma thumbnails', exact: true }).click();
  const overview = window.getByRole('button', { name: 'Deck overview', exact: true });
  await overview.focus();
  await overview.press('Enter');
  const dialog = window.getByRole('dialog', { name: 'Deck overview', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close overview', exact: true }).click();
  await expect(overview).toBeFocused();
  expect(running.problems).toEqual([]);
});

test('long project names use available title-bar space without displacing narrow-window actions', async () => {
  await demo();
  const { window, application, directory } = running;
  const header = window.getByRole('banner');
  const name = header.getByLabel('Project name', { exact: true });
  const projectName = 'Q4 2026 — Strategy and investor update';
  const fileName = 'quarterly-strategy-and-investor-update-2026.koma';
  await name.fill(projectName);
  await name.press('Tab');
  await answerSaveDialog(application, join(directory, fileName));
  await header.getByRole('button', { name: 'Save as', exact: true }).click();
  await expect(header.getByText('All changes saved', { exact: true })).toBeVisible();
  const filename = header.getByText(fileName, { exact: true });
  for (const width of [1480, 1120]) {
    await application.evaluate(({ BrowserWindow }, contentWidth) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(contentWidth, 700);
    }, width);
    await expect(name).toHaveValue(projectName);
    await expect
      .poll(() => name.evaluate((field) => field.scrollWidth <= field.clientWidth + 1))
      .toBe(true);
    await expect
      .poll(() => filename.evaluate((label) => label.scrollWidth <= label.clientWidth + 1))
      .toBe(true);
    for (const action of [
      'Save',
      'Save as',
      'Export',
      'Preview',
      'Present',
      'Getting started',
      'Settings',
    ]) {
      await expect(header.getByRole('button', { name: action, exact: true })).toBeInViewport({
        ratio: 1,
      });
    }
    await expect(header.getByRole('button', { name: 'Preview', exact: true })).toBeEnabled();
    await window.screenshot({
      path: test.info().outputPath(`long-title-${width}.png`),
      scale: 'css',
    });
  }
  await name.fill('');
  await expect(header.getByRole('alert')).toContainText('A project needs a name');
  await expect(header.getByRole('alert')).toBeInViewport({ ratio: 1 });
  await window.screenshot({
    path: test.info().outputPath('empty-title-error-1120.png'),
    scale: 'css',
  });
  await name.fill(projectName);
  await name.press('Tab');
  await expect(header.getByRole('alert')).toHaveCount(0);
  expect(running.problems).toEqual([]);
});

test('the example count agrees with its request and does not manufacture a mismatch warning', async () => {
  await create();
  const { window } = running;
  await window.getByRole('button', { name: 'Use the example request' }).click();
  await expect(countTrigger(window)).toContainText('3 Komas');
  await window.getByRole('button', { name: 'Generate Komas', exact: true }).click();
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
  await expect(window.getByText(/5 Komas were requested/)).toHaveCount(0);
});

test('an existing deck offers a selected-Koma example instead of the new-deck demo', async () => {
  await create();
  const { window } = running;
  await window.getByRole('button', { name: 'Add first Koma', exact: true }).click();
  await expect(
    window.getByRole('heading', { name: 'What would you like to change?', exact: true }),
  ).toBeVisible();
  await expect(window.getByText('Try the three-Koma demo.', { exact: true })).toHaveCount(0);
  await window.getByRole('button', { name: 'Try a selected-Koma proposal', exact: true }).click();
  await expect(window.getByLabel('Generation scope')).toHaveValue('selected');
  await expect(window.getByLabel('Your request')).toHaveValue(
    'Make this Koma clearer while keeping its main idea and styling.',
  );
  await window.getByRole('button', { name: 'Generate Komas', exact: true }).click();
  await expect(window.getByRole('region', { name: 'Selected Koma proposal' })).toBeVisible();
  await expect(
    window.getByRole('list', { name: 'Komas', exact: true }).getByRole('listitem'),
  ).toHaveCount(1);
});

test('a selected-Koma proposal reads as ready for review and stays undoable after applying', async () => {
  await demo();
  const { window } = running;
  await window.getByRole('button', { name: 'Koma 2: The motion engine', exact: true }).click();
  await window.getByLabel('Generation scope').selectOption('selected');
  await window.getByLabel('Your request').fill('Refine this Koma.');
  await window.getByRole('button', { name: 'Generate Komas', exact: true }).click();
  const proposal = window.getByRole('region', { name: 'Selected Koma proposal' });
  await expect(proposal).toBeVisible();
  const log = window.getByRole('log', { name: 'Conversation' });
  await expect(log.getByText('Proposal ready', { exact: true })).toBeVisible();
  await expect(log.getByText('Generated Komas were not applied', { exact: true })).toHaveCount(0);
  await proposal.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(
    window.getByRole('button', { name: 'Koma 2: Revised: The motion engine', exact: true }),
  ).toBeVisible();
  await expect(log.getByText('Generated Komas were not applied', { exact: true })).toHaveCount(0);
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    window.getByRole('button', { name: 'Koma 2: The motion engine', exact: true }),
  ).toBeVisible();
});

test('a healthy project does not show instructions about unresolved issues', async () => {
  await create();
  const { window } = running;
  await window.getByRole('button', { name: 'Project health', exact: true }).click();
  const health = window.getByRole('dialog', { name: 'Project health', exact: true });
  await expect(health).toContainText('No project issues found.');
  await expect(health.getByText(/Hiding a notification does not fix/)).toHaveCount(0);
});

test('a blank deck is not told to add another Koma', async () => {
  await create();
  const { window } = running;
  await expect(window.getByText('Add another Koma for motion.', { exact: true })).toHaveCount(0);
  await window.getByRole('button', { name: 'Add first Koma', exact: true }).click();
  await expect(window.getByText('Add another Koma for motion.', { exact: true })).toBeVisible();
});

test('mock run details show only the active provider without starting another request', async () => {
  await demo();
  const { window } = running;
  await window.getByRole('button', { name: 'Run details', exact: true }).click();
  const monitor = window.getByRole('dialog', { name: 'Run monitor', exact: true });
  await expect(
    window.getByRole('log', { name: 'Conversation' }).getByText(/You asked:/),
  ).toHaveCount(1);
  await expect(monitor).toContainText('Mock provider');
  await expect(monitor.getByRole('button', { name: 'Cancel run' })).toHaveCount(0);
  await expect(monitor.getByText(/Claude Code runs in print mode/)).toHaveCount(0);
  await expect(monitor.getByRole('region', { name: 'Timeline', exact: true })).toContainText(
    'Preparing the request',
  );
});

test('export groups repeated font caveats without losing their details or the destination action', async () => {
  await demo();
  const { window, application, directory } = running;
  await window.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = window.getByRole('dialog', { name: 'Export PowerPoint', exact: true });
  const summary = dialog
    .locator('summary')
    .filter({ hasText: 'PowerPoint approximates font weights' });
  await expect(summary).toBeVisible();
  const destination = dialog.getByRole('button', { name: 'Choose destination', exact: true });
  await expect(destination).toBeEnabled();
  await expect(destination).toBeInViewport();
  await summary.click();
  const details = dialog.getByRole('list', { name: 'Affected text objects', exact: true });
  await expect(details).toBeVisible();
  expect(await details.getByRole('listitem').count()).toBeGreaterThan(1);
  await expect(details).toContainText('PowerPoint export approximates it as regular or bold.');
  await summary.click();
  await expect(details).toBeHidden();
  const output = join(directory, 'ui-export.pptx');
  await answerSaveDialog(application, output);
  await destination.click();
  await expect(dialog.getByRole('status')).toContainText('Your Koma project is unchanged.');
  await expect(dialog.getByRole('list', { name: 'Export compatibility notes' })).toHaveCount(0);
  await expect(dialog.getByRole('list', { name: 'Export warnings' })).toBeVisible();
  expect((await stat(output)).size).toBeGreaterThan(0);
});

test('model caveats remain reachable without repeating every paragraph in Settings', async () => {
  await create();
  const { window } = running;
  await openSettingsPage(window, 'Generation');
  await expect(window.getByLabel('Model for Claude Code', { exact: true })).toHaveCount(0);
  await window.getByRole('button', { name: 'Choose model in chat' }).click();
  const chooser = window.getByRole('dialog', { name: 'Model', exact: true });
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole('searchbox', { name: 'Search models' })).toBeFocused();
  const options = await openProviderChoices(window);
  await options.getByLabel('Provider', { exact: true }).selectOption('claude-code');
  const details = options.locator('summary[aria-label="About Claude Code model choices"]');
  await expect(details).toBeVisible();
  await details.focus();
  await window.keyboard.press('Enter');
  await expect(window.getByText(/This catalog does not guarantee account access/)).toBeVisible();
});

test('canvas and panel navigation preserve the sent request and the empty follow-up draft', async () => {
  await create();
  const { window } = running;
  const keys: { key: string; target: string; at: number }[] = [];
  await window.exposeFunction(
    'recordAuditKey',
    (entry: { key: string; target: string; at: number }) => keys.push(entry),
  );
  await window.evaluate(() => {
    document.addEventListener('keydown', (event) => {
      const recorder = (
        window as unknown as {
          recordAuditKey: (entry: { key: string; target: string; at: number }) => Promise<void>;
        }
      ).recordAuditKey;
      void recorder({
        key: event.key,
        target: event.target instanceof Element ? event.target.outerHTML.slice(0, 160) : '',
        at: performance.now(),
      });
    });
  });
  await window.getByRole('button', { name: 'Model', exact: true }).click();
  await window.keyboard.press('Escape');
  await window.getByRole('button', { name: 'Choose Brand Kit', exact: true }).click();
  await window.keyboard.press('Escape');
  await window.getByRole('button', { name: 'Use the example request' }).click();
  const request = window.getByLabel('Your request');
  const sent = await request.inputValue();
  await window.getByRole('button', { name: 'Generate Komas', exact: true }).click();
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
  const bubble = window
    .getByRole('log', { name: 'Conversation' })
    .locator('.chat-user-bubble')
    .first();
  const expectedBubble = `You asked: ${sent}`;
  const stage = window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');
  for (let round = 0; round < 3; round += 1) {
    await window.getByRole('button', { name: 'Koma 1: One connected system', exact: true }).click();
    await stage.locator('[data-element-id]').first().click({ force: true });
    await window.getByRole('tab', { name: /^Element(?::|$)/ }).click();
    await showChat(window);
    await expect(bubble).toHaveText(expectedBubble);
    await expect(request).toHaveValue('');
    await window.getByRole('button', { name: /^Deck overview/ }).click();
    await window.getByLabel('Find a Koma').press('Escape');
    await expect(bubble).toHaveText(expectedBubble);
    await expect(request).toHaveValue('');
  }
  await writeFile(test.info().outputPath('keyboard-events.json'), JSON.stringify(keys, null, 2));
  expect(running.problems).toEqual([]);
});
