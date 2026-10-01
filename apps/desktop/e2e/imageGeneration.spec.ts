import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { komaProjectSchema } from '@koma-motion/core';
import { launchApplication, answerSaveDialog, answerOpenDialog } from './application';
import { modelTrigger, openModelChoices } from './composerControls';

for (const provider of ['codex', 'grok'] as const) {
  for (const outcome of ['success', 'failure', 'cancel'] as const) {
    test(`${provider} CLI image generation ${outcome} with isolated mock images`, async () => {
      const choice = provider === 'grok' ? /^Grok Imagine/ : /^Codex/;
      const info = test.info();
      const running = await launchApplication({
        env: { KOMA_MOCK_DELAY_MS: '20', KOMA_MOCK_IMAGES: outcome },
      });
      const { window, application, directory } = running;
      try {
        await window.getByRole('button', { name: 'Create a project' }).click();
        const picker = await openModelChoices(window);
        await picker.getByRole('tab', { name: 'Images', exact: true }).click();
        await picker.getByRole('tab', { name: 'Images', exact: true }).press('ArrowLeft');
        await expect(picker.getByRole('tab', { name: 'Text', exact: true })).toBeFocused();
        await picker.getByRole('tab', { name: 'Text', exact: true }).press('ArrowRight');
        await expect(picker.getByRole('tabpanel', { name: 'Images', exact: true })).toBeVisible();
        await expect(picker.getByRole('button', { name: /^Off/ })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await picker.getByRole('button', { name: choice }).click();
        await expect(picker.getByRole('button', { name: choice })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await expect(modelTrigger(window)).toHaveText('Mock provider · Demo');
        await window
          .getByRole('region', { name: 'Agent chat' })
          .screenshot({ path: info.outputPath('images-picker.png'), scale: 'css' });
        const divider = window.getByRole('separator', { name: 'Resize the chat' });
        await window.keyboard.press('Escape');
        await divider.focus();
        await divider.press('Home');
        await modelTrigger(window).click();
        await picker.getByRole('tab', { name: /^Images/ }).click();
        await expect(picker).toBeInViewport({ ratio: 1 });
        await window
          .getByRole('region', { name: 'Agent chat' })
          .screenshot({ path: info.outputPath('images-picker-narrow.png'), scale: 'css' });
        await window.keyboard.press('Escape');
        await window.getByLabel('Your request').fill('Create a presentation with an illustration.');
        await window.getByRole('button', { name: 'Generate Komas' }).click();
        await expect(
          window
            .getByText(`Generating image 1 of 1 with ${provider === 'grok' ? 'Grok' : 'Codex'}`, {
              exact: true,
            })
            .first(),
        ).toBeVisible();
        if (outcome === 'cancel')
          await window.getByRole('button', { name: 'Cancel', exact: true }).click();
        if (outcome === 'success') await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
        else if (outcome === 'cancel')
          await expect(window.getByText('Your presentation was not changed.')).toBeVisible();
        else await expect(window.getByText(/No Komas were replaced/).first()).toBeVisible();
        const path = join(directory, 'images.koma');
        await answerSaveDialog(application, path);
        await window.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(window.getByText('All changes saved')).toBeVisible();
        const saved = komaProjectSchema.parse(JSON.parse(await readFile(path, 'utf8')));
        expect(saved.agentConfiguration.imageGeneration).toBe(provider);
        expect(saved.agentConfiguration.selectedProviderId).toBe('mock');
        expect(saved.assets).toHaveLength(outcome === 'success' ? 1 : 0);
        expect(saved.presentation.komas).toHaveLength(outcome === 'success' ? 3 : 0);
        if (outcome === 'success') {
          expect(saved.assets[0]?.embeddedData?.data.length).toBeGreaterThan(0);
          expect(
            saved.presentation.komas.some((koma) =>
              koma.elements.some(
                (element) =>
                  element.type === 'image' && element.content.assetId === saved.assets[0]?.id,
              ),
            ),
          ).toBe(true);
          await window.getByRole('button', { name: 'Undo', exact: true }).click();
          await window.getByRole('button', { name: 'Save', exact: true }).click();
          await expect(window.getByText('All changes saved')).toBeVisible();
          const undone = komaProjectSchema.parse(JSON.parse(await readFile(path, 'utf8')));
          expect(undone.assets).toHaveLength(0);
          expect(undone.presentation.komas).toHaveLength(0);
          await window.getByRole('button', { name: 'Redo', exact: true }).click();
          await window.getByRole('button', { name: 'Save', exact: true }).click();
          await expect(window.getByText('All changes saved')).toBeVisible();
          await answerOpenDialog(application, path);
          await window.getByRole('button', { name: 'Open', exact: true }).click();
          const reopened = await openModelChoices(window);
          await reopened.getByRole('tab', { name: /^Images/ }).click();
          await expect(reopened.getByRole('button', { name: choice })).toHaveAttribute(
            'aria-pressed',
            'true',
          );
          await reopened.getByRole('button', { name: /^Off/ }).click();
          await window.keyboard.press('Escape');
          await window.getByRole('button', { name: 'Undo', exact: true }).click();
          await openModelChoices(window);
          await picker.getByRole('tab', { name: /^Images/ }).click();
          await expect(picker.getByRole('button', { name: choice })).toHaveAttribute(
            'aria-pressed',
            'true',
          );
        }
        expect(running.problems).toEqual([]);
      } finally {
        await running.close();
      }
    });
  }
}
