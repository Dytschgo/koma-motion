import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mockModelDiscovery } from './modelFixtures';
import {
  _electron as electron,
  expect,
  type ElectronApplication,
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
    /** Added to the environment, for example KOMA_MOCK_DELAY_MS. */
    readonly env?: Readonly<Record<string, string>>;
    /** Records a video of every window into this folder. */
    readonly recordVideoDirectory?: string;
  } = {},
): Promise<RunningApplication> {
  const directory = await mkdtemp(join(tmpdir(), 'koma-motion-e2e-'));
  const userData = `--user-data-dir=${join(directory, 'user-data')}`;
  // CI machines have small screens, and a window never grows beyond its
  // screen. At half the device scale factor a Windows screen holds the full
  // 1480 x 920 window. macOS keeps its own scale, so its window can be
  // narrow: see showInspector and showChat. Documentation screenshots keep
  // the real scale.
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

/** The window is wide enough for the canvas, the Inspector and the chat side by side. */
export async function isWideWindow(window: Page): Promise<boolean> {
  return (await window.evaluate(() => innerWidth)) >= 1400;
}

/**
 * Makes the Inspector visible. In a narrow window the open chat takes its
 * place, so the chat is hidden, as a user would do.
 */
export async function showInspector(window: Page): Promise<void> {
  if (!(await isWideWindow(window))) {
    const hide = window.getByRole('button', { name: 'Hide the chat' });
    if (await hide.isVisible()) {
      await hide.click();
    }
  }
  await expect(window.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
}

/** Makes the chat visible again after showInspector. */
export async function showChat(window: Page): Promise<void> {
  const show = window.getByRole('button', { name: /^Show the chat/ });
  if (await show.isVisible()) {
    await show.click();
  }
  await expect(window.getByRole('button', { name: 'Hide the chat' })).toBeVisible();
}

/**
 * Opens Settings on one of its categories, for example 'Generation' or
 * 'Updates'. Settings remembers the last page, so tests name the page they need.
 */
export async function openSettingsPage(window: Page, page: string): Promise<void> {
  const dialog = window.getByRole('dialog', { name: 'Settings', exact: true });
  if (!(await dialog.isVisible())) {
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
  }
  await dialog
    .getByRole('navigation', { name: 'Settings categories' })
    .getByRole('button', { name: page, exact: true })
    .click();
}
