import {
  createDefaultBrandKit,
  serialiseBrandKitLibrary,
  type SavedBrandKit,
} from '@koma-motion/brand-kit';
import { komaProjectSchema } from '@koma-motion/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { answerSaveDialog, launchApplication, type RunningApplication } from './application';
import { modelTrigger, openModelChoices, openProviderChoices } from './composerControls';

let running: RunningApplication;
test.beforeEach(async () => {
  running = await launchApplication({ env: { KOMA_MOCK_DELAY_MS: '1200' } });
});
test.afterEach(async () => {
  await running.close();
});

async function writeLibrary(
  names = ['Koma Studio', 'Paper & Ink', 'Northern', 'Studio Mono'],
): Promise<void> {
  const base = createDefaultBrandKit();
  const colours = ['#7cc4e8', '#d5c3a4', '#84ac9d', '#92989e'];
  const kits: SavedBrandKit[] = names.map((name, index) => ({
    id: `chat-kit-${String(index)}`,
    name,
    createdAt: '2026-10-01T12:00:00Z',
    updatedAt: '2026-10-01T12:00:00Z',
    logo: null,
    brandKit: {
      ...base,
      name,
      logoAssetId: null,
      colours: { ...base.colours, primary: colours[index % colours.length] ?? '#7cc4e8' },
    },
  }));
  const folder = join(running.directory, 'user-data', 'brand-kits');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'library.json'), serialiseBrandKitLibrary(kits));
}

test('switches saved kits beside the model, follows undo and persists the selection', async () => {
  const info = test.info();
  const { window, application, directory, problems } = running;
  await writeLibrary();
  await window.getByRole('button', { name: 'Create a project' }).click();
  const trigger = window.getByRole('button', { name: 'Choose Brand Kit', exact: true });
  const chooser = window.getByRole('dialog', { name: 'Choose Brand Kit', exact: true });
  await trigger.click();
  await expect(chooser.getByText('4 available')).toBeVisible();
  await expect(chooser.getByRole('button')).toHaveCount(4);
  await chooser.press('ArrowDown');
  await expect(chooser.getByRole('button', { name: 'Koma Studio', exact: true })).toBeFocused();
  await window.keyboard.press('Enter');
  await expect(chooser).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-description', 'Koma Studio');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(chooser.getByRole('button', { name: 'Koma Studio', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await chooser.getByRole('button', { name: 'Northern', exact: true }).click();
  await expect(trigger).toHaveAttribute('aria-description', 'Northern');
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(trigger).toHaveAttribute('aria-description', 'Koma Studio');
  await trigger.click();
  await expect(chooser.getByRole('button', { name: 'Koma Studio', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(chooser.getByRole('button', { name: 'Northern', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await window.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await window.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(trigger).toHaveAttribute('aria-description', 'Northern');
  await window.getByLabel('Your request').fill('Give the opening a stronger visual hierarchy.');
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  await expect(trigger).toBeDisabled();
  await expect(modelTrigger(window)).toBeDisabled();
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
  const savedPath = join(directory, 'chat-brand.koma');
  await answerSaveDialog(application, savedPath);
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('All changes saved')).toBeVisible();
  const saved = komaProjectSchema.parse(JSON.parse(await readFile(savedPath, 'utf8')));
  expect(saved.brandKit.name).toBe('Northern');
  expect(saved.brandKit.colours.primary).toBe('#84AC9D');
  await window.getByLabel('Your request').fill('Give the final Koma a stronger ending.');
  const notices = window
    .getByRole('list', { name: 'Messages' })
    .getByRole('button', { name: 'Dismiss' });
  while (await notices.count()) await notices.first().click();
  for (const width of [480, 300]) {
    const divider = window.getByRole('separator', { name: 'Resize the chat' });
    await divider.focus();
    await divider.press('Home');
    for (let current = 300; current < width; current += 16) await divider.press('ArrowLeft');
    await trigger.click();
    const chat = window.getByRole('region', { name: 'Agent chat' });
    const chatBox = await chat.boundingBox();
    const popupBox = await chooser.boundingBox();
    expect(chatBox).not.toBeNull();
    expect(popupBox).not.toBeNull();
    expect(popupBox!.x).toBeGreaterThanOrEqual(chatBox!.x);
    expect(popupBox!.x + popupBox!.width).toBeLessThanOrEqual(chatBox!.x + chatBox!.width);
    await expect(chooser).toBeInViewport({ ratio: 1 });
    await window.screenshot({
      path: info.outputPath(`brand-picker-${String(width)}.png`),
      scale: 'css',
    });
    await chat.screenshot({ path: info.outputPath(`chat-${String(width)}.png`), scale: 'css' });
    await writeFile(
      info.outputPath(`layout-${String(width)}.json`),
      JSON.stringify(
        await window.evaluate(() => ({
          platform: navigator.platform,
          viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
          chatWidth: document.querySelector('[aria-label="Agent chat"]')?.getBoundingClientRect()
            .width,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        })),
        null,
        2,
      ),
    );
    await window.keyboard.press('Escape');
  }
  await trigger.click();
  await modelTrigger(window).click();
  await expect(chooser).toBeHidden();
  await expect(window.getByRole('dialog', { name: 'Model', exact: true })).toBeVisible();
  await window.keyboard.press('Escape');
  await trigger.click();
  await window.getByRole('heading', { name: 'Chat', exact: true }).click();
  await expect(chooser).toBeHidden();
  await trigger.click();
  await window.getByRole('button', { name: 'Hide the chat' }).click();
  await window.getByRole('button', { name: 'Show the chat' }).click();
  await expect(chooser).toBeHidden();
  expect(problems).toEqual([]);
});

test('explains an empty or unreadable library and recovers without settings', async () => {
  const { window, directory, problems } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  const trigger = window.getByRole('button', { name: 'Choose Brand Kit', exact: true });
  const chooser = window.getByRole('dialog', { name: 'Choose Brand Kit', exact: true });
  await trigger.click();
  await expect(chooser.getByText(/No saved Brand Kits yet/)).toBeVisible();
  await window.keyboard.press('Escape');
  const folder = join(directory, 'user-data', 'brand-kits');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'library.json'), '{broken');
  await trigger.click();
  await expect(chooser.getByRole('alert')).toBeVisible();
  await writeLibrary(['A very long Brand Kit name for the international design team']);
  await chooser.getByRole('button', { name: 'Try again' }).click();
  await expect(chooser.getByRole('alert')).toHaveCount(0);
  await expect(chooser.locator('[data-kit-choice]')).toHaveCount(1);
  await chooser.locator('[data-kit-choice]').click();
  await expect(trigger).toHaveAttribute('aria-description', /international design team/);
  expect(problems).toEqual([]);
});

test('searches models across providers, selects atomically and retains custom IDs', async () => {
  const { window, problems } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  let picker = await openModelChoices(window);
  const search = picker.getByRole('searchbox', { name: 'Search models' });
  await expect(search).toBeFocused();
  await expect(picker.getByLabel('Provider', { exact: true })).toHaveCount(0);
  await expect(picker.getByRole('region', { name: 'Favorites' })).toHaveCount(0);
  await expect(picker.getByRole('region', { name: 'Models', exact: true })).toBeVisible();
  await expect(picker.locator('[data-model-choice]').first()).toHaveAttribute(
    'data-model-value',
    'claude-fable-5-1',
  );
  await search.fill('opus');
  await expect(picker.locator('[data-provider-id="codex"]')).toHaveCount(0);
  await search.press('ArrowDown');
  await window.keyboard.press('Enter');
  await expect(picker).toBeHidden();
  await expect(modelTrigger(window)).toHaveText('Claude Opus 5.5');
  await expect(modelTrigger(window)).toHaveAttribute(
    'aria-description',
    'Next run uses claude-opus-5-5',
  );
  picker = await openModelChoices(window);
  await search.fill('6.1');
  await picker.locator('[data-provider-id="codex"][data-model-value="gpt-6.1-sol"]').click();
  await expect(modelTrigger(window)).toHaveText('GPT-6.1 Sol');
  await expect(modelTrigger(window)).toHaveAttribute(
    'aria-description',
    'Next run uses gpt-6.1-sol',
  );
  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(modelTrigger(window)).toHaveText('Claude Opus 5.5');
  await window.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(modelTrigger(window)).toHaveText('GPT-6.1 Sol');
  picker = await openModelChoices(window);
  await search.fill('model-that-is-not-listed');
  await expect(picker.getByText('No matching models.')).toBeVisible();
  await picker.getByRole('button', { name: 'Model options', exact: true }).click();
  await picker.getByLabel('Model', { exact: true }).selectOption('__custom__');
  await picker.getByLabel('Model id', { exact: true }).fill('custom-model-v2');
  await picker.getByLabel('Model id', { exact: true }).press('Enter');
  await expect(modelTrigger(window)).toHaveAttribute(
    'aria-description',
    'Next run uses custom-model-v2',
  );
  await expect(picker.getByLabel('Model', { exact: true })).toBeFocused();
  await picker.getByRole('button', { name: 'Back to models' }).click();
  await search.fill('custom-model-v2');
  await expect(
    picker.locator('[data-provider-id="codex"][data-model-value="custom-model-v2"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await window.keyboard.press('Escape');
  await expect(modelTrigger(window)).toBeFocused();
  expect(problems).toEqual([]);
});

test('pins favorites without changing the project and remembers them after restart', async () => {
  const { window, problems } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  let picker = await openModelChoices(window);
  const star = picker.getByRole('button', {
    name: 'Pin Claude Sonnet 5.5 · Claude Code',
    exact: true,
  });
  await expect(star).toHaveCSS('opacity', '1');
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await expect(star.locator('svg')).toHaveAttribute('fill', 'none');
  await star.click();
  const filledStar = picker.getByRole('button', {
    name: 'Unpin Claude Sonnet 5.5 · Claude Code',
    exact: true,
  });
  await expect(filledStar).toHaveAttribute('aria-pressed', 'true');
  await expect(filledStar.locator('svg')).toHaveAttribute('fill', 'currentColor');
  await expect(
    picker
      .getByRole('region', { name: 'Favorites' })
      .locator('[data-provider-id="claude-code"][data-model-value="claude-sonnet-5-5"]'),
  ).toBeVisible();
  await expect(picker.getByRole('searchbox', { name: 'Search models' })).toBeFocused();
  await window.keyboard.press('Escape');
  await expect(window.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await window.reload();
  await window.getByRole('button', { name: 'Create a project' }).click();
  picker = await openModelChoices(window);
  await expect(
    picker
      .getByRole('region', { name: 'Favorites' })
      .locator('[data-model-value="claude-sonnet-5-5"]'),
  ).toBeVisible();
  await picker
    .getByRole('button', { name: 'Unpin Claude Sonnet 5.5 · Claude Code', exact: true })
    .click();
  await expect(
    picker
      .getByRole('region', { name: 'Favorites' })
      .locator('[data-model-value="claude-sonnet-5-5"]'),
  ).toHaveCount(0);
  await expect(
    picker
      .getByRole('region', { name: 'Models', exact: true })
      .locator('[data-model-value="claude-sonnet-5-5"]'),
  ).toBeVisible();
  await expect(star).toHaveCSS('opacity', '1');
  await expect(star.locator('svg')).toHaveAttribute('fill', 'none');
  await window.reload();
  await window.getByRole('button', { name: 'Create a project' }).click();
  picker = await openModelChoices(window);
  await expect(picker.getByRole('region', { name: 'Favorites' })).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('matches Compact 01 with provider logos beside Brand Kit at wide and narrow widths', async () => {
  const { window, problems } = running;
  const info = test.info();
  await writeLibrary();
  await window.getByRole('button', { name: 'Create a project' }).click();
  const chat = window.getByRole('region', { name: 'Agent chat' });
  const model = modelTrigger(window);
  const brand = chat.getByRole('button', { name: 'Choose Brand Kit', exact: true });
  await brand.click();
  await window
    .getByRole('dialog', { name: 'Choose Brand Kit', exact: true })
    .getByRole('button', { name: 'Koma Studio', exact: true })
    .click();
  await window.getByRole('button', { name: 'Use the example request' }).click();
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();

  // The real composer popup, not Settings, must contain both choices.
  const picker = await openModelChoices(window);
  await picker
    .getByRole('button', { name: 'Pin Claude Opus 5.5 · Claude Code', exact: true })
    .click();
  await picker.getByRole('button', { name: 'Pin GPT-6 Astra · Codex CLI', exact: true }).click();
  await picker
    .locator('[data-provider-id="claude-code"][data-model-value="claude-opus-5-5"]')
    .click();
  await expect(model).toHaveText('Claude Opus 5.5');
  await expect(picker).toBeHidden();
  await expect(model).toBeFocused();
  await window.getByLabel('Your request').fill('Give the final Koma a stronger ending.');
  const notices = window
    .getByRole('list', { name: 'Messages' })
    .getByRole('button', { name: 'Dismiss' });
  while (await notices.count()) await notices.first().click();

  for (const width of [480, 300]) {
    const divider = window.getByRole('separator', { name: 'Resize the chat' });
    await divider.focus();
    await divider.press('Home');
    for (let current = 300; current < width; current += 16) await divider.press('ArrowLeft');
    const choices = chat.getByRole('group', { name: 'Generation choices', exact: true });
    await expect(choices.getByRole('button', { name: 'Model', exact: true })).toHaveCount(1);
    await expect(chat.getByRole('button', { name: 'Provider', exact: true })).toHaveCount(0);
    await expect(
      chat.getByTestId('chat-header').getByRole('button', { name: /Model|Provider/ }),
    ).toHaveCount(0);
    const modelBox = await model.boundingBox();
    const brandBox = await brand.boundingBox();
    const requestBox = await window.getByLabel('Your request').boundingBox();
    if (!modelBox || !brandBox || !requestBox)
      throw new Error('Composer controls are not visible.');
    expect(modelBox.y).toBeGreaterThanOrEqual(requestBox.y + requestBox.height);
    expect(Math.abs(modelBox.y - brandBox.y)).toBeLessThan(2);
    expect(brandBox.x - (modelBox.x + modelBox.width)).toBeGreaterThanOrEqual(0);
    expect(brandBox.x - (modelBox.x + modelBox.width)).toBeLessThan(12);
    await chat.screenshot({
      path: info.outputPath(`adjacent-pickers-${String(width)}.png`),
      scale: 'css',
    });
    await openModelChoices(window);
    await expect(picker.getByLabel('Provider', { exact: true })).toHaveCount(0);
    await expect(
      picker.getByRole('region', { name: 'Favorites' }).locator('[data-provider-id="codex"]'),
    ).toHaveCount(1);
    await expect(picker.locator('img')).not.toHaveCount(0);
    // Reopening mounts new image elements; their bundled SVGs may still be decoding.
    await expect
      .poll(() =>
        picker
          .locator('img')
          .evaluateAll((images) =>
            images.every(
              (image) =>
                image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    await expect(picker.locator('[data-provider-logo="claude-code"]').first()).toBeVisible();
    await expect(picker.locator('[data-provider-logo="codex"]').first()).toBeVisible();
    await expect(picker.locator('[data-model-value="claude-opus-5-5"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(picker).toBeInViewport({ ratio: 1 });
    expect((await picker.boundingBox())?.height).toBeLessThanOrEqual(448);
    await writeFile(
      info.outputPath(`display-${String(width)}.json`),
      JSON.stringify(
        await window.evaluate(() => ({
          viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          chatWidth: document.querySelector('[aria-label="Agent chat"]')?.getBoundingClientRect()
            .width,
        })),
        null,
        2,
      ),
    );
    await window.screenshot({
      path: info.outputPath(`model-open-${String(width)}.png`),
      scale: 'css',
    });
    await chat.screenshot({
      path: info.outputPath(`model-chat-${String(width)}.png`),
      scale: 'css',
    });
    await window.keyboard.press('Escape');
    await brand.click();
    await expect(picker).toBeHidden();
    await chat.screenshot({
      path: info.outputPath(`brand-open-${String(width)}.png`),
      scale: 'css',
    });
    await window.keyboard.press('Escape');
  }

  // A typed draft from one provider must not leak into another provider's editor.
  await openProviderChoices(window);
  await picker.getByLabel('Model', { exact: true }).selectOption('__custom__');
  await picker.getByLabel('Model id', { exact: true }).fill('unfinished-claude-id');
  await picker.getByLabel('Provider', { exact: true }).selectOption('codex');
  await expect(picker.getByLabel('Model id', { exact: true })).toHaveCount(0);
  await picker.getByLabel('Provider', { exact: true }).selectOption('claude-code');
  await expect(picker.getByLabel('Model', { exact: true })).toHaveValue('claude-opus-5-5');
  expect(problems).toEqual([]);
});
