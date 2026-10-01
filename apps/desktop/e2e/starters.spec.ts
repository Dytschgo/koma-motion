import { getStarterPreset } from '@koma-motion/brand-kit';
import { expect, test } from '@playwright/test';
import { countTrigger } from './composerControls';
import {
  launchApplication,
  openSettingsPage,
  showChat,
  type RunningApplication,
} from './application';

let running: RunningApplication;

test.beforeEach(async () => {
  running = await launchApplication();
});

test.afterEach(async () => {
  await running.close();
});

test('starts a project from a starter with its Brand Kit, instructions and request', async () => {
  const { window, problems } = running;
  const starter = getStarterPreset('solar-system');
  const starters = window.getByRole('list', { name: 'Starters' });
  await expect(starters.getByRole('button')).toHaveCount(3);

  await starters.getByRole('button', { name: 'Start Solar system' }).click();
  await expect(window.getByLabel('Project name')).toHaveValue('Solar system');
  await showChat(window);
  await expect(window.getByLabel('Your request')).toHaveValue(starter.request);
  await expect(countTrigger(window)).toHaveAttribute('aria-description', '7 Komas');
  await expect(window.getByRole('button', { name: 'Instructions & templates' })).toHaveAttribute(
    'aria-description',
    'Instructions active',
  );

  await window.getByRole('button', { name: 'Brand Kit', exact: true }).first().click();
  await expect(window.getByLabel('Brand name')).toHaveValue('Deep Orbit');

  // The mock provider still answers with its demonstration deck.
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  await expect(
    window.getByRole('list', { name: 'Komas' }).getByRole('button', { name: /^Koma \d:/ }),
  ).toHaveCount(3);
  expect(problems).toEqual([]);
});

test('applies a starter to an open project in one undoable step', async () => {
  const { window, problems } = running;
  const starter = getStarterPreset('rapunzel');
  await window.getByRole('button', { name: 'Create a project' }).click();
  await expect(window.getByLabel('Project name')).toBeVisible();

  await openSettingsPage(window, 'Templates');
  await window
    .getByRole('list', { name: 'Starters' })
    .getByRole('button', { name: 'Apply Rapunzel story' })
    .click();
  await expect(window.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
  await showChat(window);
  await expect(window.getByLabel('Your request')).toHaveValue(starter.request);

  await openSettingsPage(window, 'Instructions');
  await expect(window.getByLabel('Project system instructions')).toHaveValue(
    starter.systemInstructions,
  );
  await window.getByRole('button', { name: 'Done' }).click();

  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await openSettingsPage(window, 'Instructions');
  await expect(window.getByLabel('Project system instructions')).toHaveValue('');
  await window.getByRole('button', { name: 'Done' }).click();
  expect(problems).toEqual([]);
});
