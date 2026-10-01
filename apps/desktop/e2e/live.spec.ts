/**
 * Runs the application with an agent CLI that is installed on this computer.
 * It only runs on request, because it uses the account of the person who runs it:
 *
 *   KOMA_LIVE_E2E=claude-code KOMA_LIVE_MODEL=<model> pnpm test:e2e live
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { komaProjectSchema } from '@koma-motion/core';
import { expect, test } from '@playwright/test';
import { chooseModel, openProviderChoices, setKomaCount } from './composerControls';
import {
  answerOpenDialog,
  answerSaveDialog,
  launchApplication,
  openSettingsPage,
} from './application';

const provider = process.env['KOMA_LIVE_E2E'] ?? '';
const model = process.env['KOMA_LIVE_MODEL'] ?? '';
const OUTPUT_DIRECTORY = process.env['KOMA_LIVE_OUTPUT_DIR']
  ? resolve(process.env['KOMA_LIVE_OUTPUT_DIR'])
  : resolve(import.meta.dirname, '../test-results/live');
const REQUEST =
  'Create a three-frame presentation for a fictional Harbor Cafe launch. First introduce the cafe and its neighbourhood customers, then show a simple launch plan, then show the next steps for opening day. Use only invented example details. Keep it simple: at most 8 elements per frame.';

test.skip(provider !== 'claude-code', 'Live tests run on request');
test.setTimeout(12 * 60_000);

test('generates a presentation with Claude Code', async () => {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const running = await launchApplication();
  const { window, application } = running;
  const filePath = join(OUTPUT_DIRECTORY, 'claude-code.koma');
  const editedPath = join(OUTPUT_DIRECTORY, 'claude-code-edited.koma');
  const stage = window.getByRole('region', { name: 'Canvas' }).locator('[data-koma-stage]');

  try {
    await window.getByRole('button', { name: 'Create a project' }).click();
    await window.getByLabel('Project name').fill('Generated with Claude Code');

    // Match the application's deadline to the wait below, including repair.
    await openSettingsPage(window, 'Generation');
    await window.getByLabel('Stop generation after a time limit').check();
    await window.getByLabel('Time limit in seconds').fill('600');
    if (model !== '') {
      await chooseModel(window, 'Model for Claude Code', model);
    }
    await window.getByRole('button', { name: 'Done' }).click();

    const providerChoices = await openProviderChoices(window);
    await providerChoices.getByLabel('Provider', { exact: true }).selectOption('claude-code');
    await expect(providerChoices.getByRole('status').filter({ hasText: 'Ready' })).toBeVisible();
    await window.getByRole('button', { name: 'Model', exact: true }).click();

    await setKomaCount(window, '3');
    await window.getByLabel('Your request').fill(REQUEST);
    await window.getByRole('button', { name: 'Generate Komas' }).click();
    await expect(window.getByRole('button', { name: 'Cancel' })).toBeVisible();

    const komas = window
      .getByRole('list', { name: 'Komas' })
      .getByRole('button', { name: /^Koma \d:/ });
    const failure = window.getByText(/^Generation (failed|stopped|took too long)$/);
    // Wait for a terminal result, rather than any card that might already exist.
    await expect(window.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0, {
      timeout: 10 * 60_000 + 15_000,
    });
    await window.screenshot({ path: join(OUTPUT_DIRECTORY, 'result.png') });
    await expect(failure).toHaveCount(0);
    await expect(window.getByText(/^Created 3 Komas/)).toBeVisible();
    await expect(komas).toHaveCount(3);

    await answerSaveDialog(application, filePath);
    await window.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(window.getByText('All changes saved')).toBeVisible();
    const saved = komaProjectSchema.parse(JSON.parse(await readFile(filePath, 'utf8')));
    expect(saved).toMatchObject({
      agentConfiguration: { selectedProviderId: 'claude-code' },
      generationHistory: [{ providerId: 'claude-code', status: 'succeeded' }],
    });
    expect(saved.presentation.transitions).toHaveLength(2);

    for (const [index, koma] of saved.presentation.komas.entries()) {
      await komas.nth(index).click();
      const texts = koma.elements.filter(
        (element) =>
          element.type === 'text' &&
          element.visible &&
          element.opacity > 0 &&
          element.content.text.trim() !== '',
      );
      expect(texts.length, `Koma ${String(index + 1)} has generated text`).toBeGreaterThan(0);
      for (const element of texts) {
        await expect(stage.locator(`[data-persistent-id="${element.persistentId}"]`)).toBeVisible();
        if (element.type === 'text') {
          await expect(
            stage.locator(`[data-persistent-id="${element.persistentId}"]`),
          ).toContainText(element.content.text);
        }
      }
      await window.screenshot({ path: join(OUTPUT_DIRECTORY, `koma-${String(index + 1)}.png`) });
    }

    const firstKoma = saved.presentation.komas[0];
    const editable = firstKoma?.elements.find(
      (element) =>
        element.type === 'text' && !element.locked && element.visible && element.opacity > 0,
    );
    if (editable?.type !== 'text') throw new Error('The first Koma has no editable text');
    // A short replacement tests editing without adding lines beyond the AI's layout.
    const editedText = editable.content.text === 'Test edit' ? 'Test copy' : 'Test edit';
    await komas.first().click();
    await stage.locator(`[data-persistent-id="${editable.persistentId}"]`).click();
    await window.getByLabel('Text', { exact: true }).fill(editedText);
    await expect(stage.locator(`[data-persistent-id="${editable.persistentId}"]`)).toContainText(
      editedText,
    );
    await window.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(window.getByLabel('Text', { exact: true })).toHaveValue(editable.content.text);
    await window.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(window.getByLabel('Text', { exact: true })).toHaveValue(editedText);

    await answerSaveDialog(application, editedPath);
    await window.getByRole('button', { name: 'Save as', exact: true }).click();
    await expect(window.getByText('All changes saved')).toBeVisible();
    const edited = komaProjectSchema.parse(JSON.parse(await readFile(editedPath, 'utf8')));
    expect(edited.presentation.komas[0]?.elements).toContainEqual(
      expect.objectContaining({
        persistentId: editable.persistentId,
        content: { text: editedText },
      }),
    );

    await window.getByRole('button', { name: 'New', exact: true }).click();
    await expect(komas).toHaveCount(0);
    await answerOpenDialog(application, editedPath);
    await window.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(komas).toHaveCount(3);
    await expect(window.getByText('All changes saved')).toBeVisible();
    await komas.first().click();
    await expect(stage.locator(`[data-persistent-id="${editable.persistentId}"]`)).toContainText(
      editedText,
    );
    await window.screenshot({ path: join(OUTPUT_DIRECTORY, 'reopened.png') });

    for (const index of [0, 1]) {
      await komas.nth(index).click();
      // Generated durations can be too brief to observe reliably in automation.
      // Change only the open copy; keep both saved evidence files untouched.
      await window.getByLabel('Transition duration in seconds').fill('2');
      await window.getByRole('button', { name: 'Preview', exact: true }).click();
      await expect(stage).toHaveAttribute('aria-label', /^Preview of the transition/);
      await expect(stage).toHaveAttribute(
        'aria-label',
        `Koma ${String(index + 2)}: ${saved.presentation.komas[index + 1]?.title ?? ''}`,
        { timeout: 15_000 },
      );
    }
    expect(running.problems).toEqual([]);
    await writeFile(
      join(OUTPUT_DIRECTORY, 'verification.json'),
      JSON.stringify(
        {
          provider,
          model: model || 'CLI default',
          request: REQUEST,
          komas: saved.presentation.komas.map((koma) => ({
            title: koma.title,
            elements: koma.elements.length,
          })),
          checks: [
            'visible text',
            'edit',
            'undo',
            'redo',
            'save',
            'reopen',
            'both previews',
            'no renderer errors',
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await running.close();
  }
});
