import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mockModelDiscovery } from './modelFixtures';
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';

// A copied build keeps parallel development rebuilds from deleting a test's renderer files.
export const APPLICATION_DIRECTORY = resolve(
  process.env['KOMA_E2E_APPLICATION_DIRECTORY'] ?? resolve(import.meta.dirname, '..'),
);

export interface RunningApplication {
  readonly application: ElectronApplication;
  readonly window: Page;
  /** A folder for the files of this test. It is removed when the application closes. */
  readonly directory: string;
  /** Errors and failed requests reported by the window. */
  readonly problems: string[];
  close(): Promise<void>;
}

/**
 * The environment of the test without `ELECTRON_RUN_AS_NODE`. Tools that are
 * built with Electron set this variable, and it would make Electron start as
 * plain Node.js instead of as the application.
 */
export function getApplicationEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && name !== 'ELECTRON_RUN_AS_NODE') {
      environment[name] = value;
    }
  }
  return environment;
}

/**
 * Starts the built application, exactly as `pnpm start` does. With
 * `executablePath`, a packaged application is started instead.
 */
export async function launchApplication(
  options: {
    readonly executablePath?: string;
    /** Reuse an isolated profile for crash recovery checks; the test owns its cleanup. */
    readonly directory?: string;
    readonly preserveDirectory?: boolean;
    /** Added to the environment, for example KOMA_MOCK_DELAY_MS. */
    readonly env?: Readonly<Record<string, string>>;
    /** Records a video of every window into this folder. */
    readonly recordVideoDirectory?: string;
  } = {},
): Promise<RunningApplication> {
  const directory = options.directory ?? (await mkdtemp(join(tmpdir(), 'koma-motion-e2e-')));
  const userData = `--user-data-dir=${join(directory, 'user-data')}`;
  // CI machines have small screens, and a window never grows beyond its
  // screen. At half the device scale factor a Windows screen holds the full
  // 1480 x 920 window. macOS keeps its own scale, so its window can be
  // narrow. Documentation screenshots keep the real scale.
  const scale = process.env['KOMA_SCREENSHOTS'] === '1' ? [] : ['--force-device-scale-factor=0.5'];
  const application = await electron.launch(
    options.executablePath === undefined
      ? {
          args: [APPLICATION_DIRECTORY, userData, ...scale],
          cwd: APPLICATION_DIRECTORY,
          env: { ...getApplicationEnvironment(), ...options.env },
          ...(options.recordVideoDirectory === undefined
            ? {}
            : {
                recordVideo: {
                  dir: options.recordVideoDirectory,
                  size: { width: 1480, height: 920 },
                },
              }),
        }
      : {
          executablePath: options.executablePath,
          args: [userData, ...scale],
          // A packaged application must not use the network during a test.
          env: { ...getApplicationEnvironment(), KOMA_SMOKE: '1' },
        },
  );
  const window = await application.firstWindow();
  const problems: string[] = [];
  window.on('pageerror', (error) => problems.push(`Page error: ${error.message}`));
  window.on('console', (message) => {
    if (message.type() === 'error') {
      problems.push(`Console error: ${message.text()}`);
    }
  });
  await window.waitForLoadState('domcontentloaded');
  // Ordinary native tests must never discover capabilities through the user's live CLIs.
  if (
    options.executablePath === undefined &&
    !Object.keys({ ...process.env, ...options.env }).some((name) => name.startsWith('KOMA_LIVE_'))
  ) {
    await mockModelDiscovery(application);
  }

  return {
    application,
    window,
    directory,
    problems,
    async close() {
      if (application.windows().length > 0) {
        // Closing a project with unsaved changes asks what to do: answer "Do not save".
        await application.evaluate(({ dialog }) => {
          dialog.showMessageBox = () => Promise.resolve({ response: 1, checkboxChecked: false });
        });
        await application.close();
      }
      if (!options.preserveDirectory)
        await rm(directory, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

/**
 * Native dialogs cannot be operated by a test. This makes the next "Save"
 * dialog answer with `filePath`, as if the user had chosen it.
 */
export async function answerSaveDialog(
  application: ElectronApplication,
  filePath: string,
): Promise<void> {
  await application.evaluate(({ dialog }, chosen) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: chosen });
  }, filePath);
}

/** Makes the next "Open" dialog answer with `filePath`. */
export async function answerOpenDialog(
  application: ElectronApplication,
  filePath: string,
): Promise<void> {
  await application.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, filePath);
}

/** Whether a requested wide sizing scenario fits on this screen. */
export async function isWideWindow(window: Page): Promise<boolean> {
  return (await window.evaluate(() => innerWidth)) >= 1400;
}

/**
 * Opens the Inspector through Properties in the top bar, or returns to it from
 * the Brand Kit, and pins it beside the canvas so that canvas gestures in the
 * test are never covered by the floating panel.
 */
export async function showInspector(window: Page): Promise<void> {
  const inspector = window.getByRole('complementary', { name: 'Inspector' });
  if (!(await inspector.isVisible())) {
    const back = window.getByRole('button', { name: 'Back to Inspector' });
    if (await back.isVisible()) {
      await back.click();
    } else {
      await window.getByRole('button', { name: 'Properties', exact: true }).click();
    }
  }
  await expect(inspector).toBeVisible();
  const pin = window.getByRole('button', { name: 'Pin properties', exact: true });
  if (await pin.isVisible()) await pin.click();
  await expect(window.getByRole('button', { name: 'Unpin properties', exact: true })).toBeVisible();
  await expect(inspector).toBeVisible();
}

/** Expands the conversation sheet above the prompt. */
export async function showChat(window: Page): Promise<void> {
  const show = window.getByRole('button', { name: /^Show the chat/ });
  if (await show.isVisible()) await show.click();
  await expect(window.getByRole('button', { name: 'Hide the chat' })).toBeVisible();
  await expect(window.getByRole('log', { name: 'Conversation' })).toBeVisible();
}

/** Runs a command from the project menu at the start of the top bar, for example 'Save'. */
export async function chooseProjectCommand(window: Page, name: string): Promise<void> {
  await window.getByRole('button', { name: 'Project menu', exact: true }).click();
  const menu = window.getByRole('menu', { name: 'Project menu', exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name, exact: true }).click();
}

/** Runs 'Export PowerPoint' or 'Save as' from Share in the top bar. */
export async function chooseShareCommand(window: Page, name: string): Promise<void> {
  await window.getByRole('button', { name: 'Share', exact: true }).click();
  const menu = window.getByRole('menu', { name: 'Share', exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name, exact: true }).click();
}

/** Adds an element through Add element in the top bar: 'Text', 'Rectangle', 'Circle', 'Line' or 'Image'. */
export async function addElement(window: Page, name: string): Promise<void> {
  await window.getByRole('button', { name: 'Add element', exact: true }).click();
  await window
    .getByRole('menu', { name: 'Add element', exact: true })
    .getByRole('menuitem', { name, exact: true })
    .click();
}

/** Shows the project Brand Kit in the properties panel, from the project menu. */
export async function openBrandKit(window: Page): Promise<Locator> {
  const panel = window.getByRole('complementary', { name: 'Brand Kit', exact: true });
  if (!(await panel.isVisible())) await chooseProjectCommand(window, 'Brand Kit');
  await expect(panel).toBeVisible();
  return panel;
}

/** Leaves the Brand Kit and closes the properties panel, back to the canvas. */
export async function closeBrandKit(window: Page): Promise<void> {
  const panel = window.getByRole('complementary', { name: 'Brand Kit', exact: true });
  await window.getByRole('button', { name: 'Back to Inspector' }).click();
  await window.getByRole('button', { name: 'Close properties', exact: true }).click();
  await expect(panel).toBeHidden();
}

/** Checks the project instructions state on its project menu command, then closes the menu. */
export async function expectInstructionsState(window: Page, state: string): Promise<void> {
  await window.getByRole('button', { name: 'Project menu', exact: true }).click();
  await expect(
    window.getByRole('menuitem', { name: 'Instructions & templates', exact: true }),
  ).toHaveAttribute('aria-description', state);
  await window.keyboard.press('Escape');
  await expect(window.getByRole('menu', { name: 'Project menu' })).toHaveCount(0);
}

/** Shows Model, Brand Kit, Koma count and references above the prompt. */
export async function showGenerationOptions(window: Page): Promise<void> {
  const toggle = window.getByRole('button', { name: 'Generation options', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(window.getByRole('group', { name: 'Generation choices' })).toBeVisible();
}

/**
 * Shows the transition controls below the canvas without starting playback,
 * through Present or edit motion > Edit motion.
 */
export async function showTransitionControls(window: Page): Promise<Locator> {
  const transport = window.getByRole('group', { name: 'Transition preview' });
  if (!(await transport.isVisible())) {
    await window.getByRole('button', { name: 'Present or edit motion', exact: true }).click();
    await window.getByRole('menuitem', { name: 'Edit motion', exact: true }).click();
  }
  await expect(transport).toBeVisible();
  return transport;
}

/** Opens a motion marker between two filmstrip thumbnails, numbered from 1. */
export async function openMotion(window: Page, from: number): Promise<Locator> {
  const marker = window.getByRole('list', { name: 'Komas' }).getByRole('button', {
    name: new RegExp(
      `^(Preview the transition from Koma ${String(from)} to Koma ${String(from + 1)}|Motion from Koma ${String(from)} to Koma ${String(from + 1)} cannot play)$`,
    ),
  });
  await marker.click();
  const transport = window.getByRole('group', { name: 'Transition preview' });
  await expect(transport).toBeVisible();
  return transport;
}

/**
 * Opens Settings on one of its categories, for example 'Generation' or
 * 'Updates'. Settings remembers the last page, so tests name the page they need.
 */
export async function openSettingsPage(window: Page, page: string): Promise<void> {
  const dialog = window.getByRole('dialog', { name: 'Settings', exact: true });
  if (!(await dialog.isVisible())) await chooseProjectCommand(window, 'Settings');
  await dialog
    .getByRole('navigation', { name: 'Settings categories' })
    .getByRole('button', { name: page, exact: true })
    .click();
}
