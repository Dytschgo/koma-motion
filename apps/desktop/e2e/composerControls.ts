import { expect, type Locator, type Page } from '@playwright/test';

export function modelTrigger(page: Page): Locator {
  return page.getByRole('button', { name: 'Model', exact: true });
}

export function countTrigger(page: Page): Locator {
  return page.getByRole('button', { name: 'Koma count', exact: true });
}

/** Provider and model share the same composer popup. */
export async function openProviderChoices(page: Page): Promise<Locator> {
  const dialog = await openModelChoices(page);
  await dialog.getByRole('button', { name: 'Model options', exact: true }).click();
  await expect(dialog.getByLabel('Provider', { exact: true })).toBeVisible();
  return dialog;
}

export async function openModelChoices(page: Page): Promise<Locator> {
  const trigger = modelTrigger(page);
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Model', exact: true });
  await expect(dialog).toBeVisible();
  const textTab = dialog.getByRole('tab', { name: 'Text', exact: true });
  if ((await textTab.getAttribute('aria-selected')) !== 'true') await textTab.click();
  const back = dialog.getByRole('button', { name: 'Back to models', exact: true });
  if (await back.count()) await back.click();
  return dialog;
}

export async function selectProvider(page: Page, id: string): Promise<void> {
  const dialog = await openProviderChoices(page);
  await dialog.getByLabel('Provider', { exact: true }).selectOption(id);
  await modelTrigger(page).click();
}

export async function openCountChoices(page: Page): Promise<Locator> {
  const trigger = countTrigger(page);
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Koma count' });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function setKomaCount(page: Page, count: string): Promise<void> {
  const dialog = await openCountChoices(page);
  const input = dialog.getByRole('spinbutton', { name: 'Komas' });
  await input.fill(count);
  await input.press('Enter');
}

/**
 * Chooses a model in a model picker labelled `label`: a listed model is
 * selected, any other id is typed under "Enter a model id".
 */
export async function chooseModel(
  scope: Page | Locator,
  label: string,
  model: string,
): Promise<void> {
  const select = scope.getByLabel(label, { exact: true });
  const values = await select
    .locator('option')
    .evaluateAll((options) => options.map((option) => option.getAttribute('value') ?? ''));
  if (values.includes(model)) {
    await select.selectOption(model);
    return;
  }
  await select.selectOption('__custom__');
  const field = scope.getByLabel('Model id', { exact: true });
  await field.fill(model);
  await field.press('Enter');
}
