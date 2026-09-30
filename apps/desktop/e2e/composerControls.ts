import { expect, type Locator, type Page } from '@playwright/test';

export function providerTrigger(page: Page): Locator {
  return page.getByRole('button', { name: 'Provider and model' });
}

export function countTrigger(page: Page): Locator {
  return page.getByRole('button', { name: 'Koma count', exact: true });
}

export async function openProviderChoices(page: Page): Promise<Locator> {
  const trigger = providerTrigger(page);
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Provider and model' });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function selectProvider(page: Page, id: string): Promise<void> {
  const dialog = await openProviderChoices(page);
  await dialog.getByLabel('Provider', { exact: true }).selectOption(id);
  await providerTrigger(page).click();
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
