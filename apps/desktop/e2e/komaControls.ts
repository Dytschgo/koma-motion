import { expect, type Locator, type Page } from '@playwright/test';

export async function openKomaActions(window: Page): Promise<Locator> {
  await window.getByRole('button', { name: 'Koma actions', exact: true }).click();
  const menu = window.getByRole('menu', { name: 'Koma actions', exact: true });
  await expect(menu).toBeVisible();
  return menu;
}

export async function chooseKomaAction(window: Page, name: string): Promise<void> {
  const menu = await openKomaActions(window);
  await menu.getByRole('menuitem', { name, exact: true }).click();
}
