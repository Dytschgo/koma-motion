import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

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
  options: { readonly executablePath?: string } = {},
): Promise<RunningApplication> {
  const directory = await mkdtemp(join(tmpdir(), 'koma-motion-e2e-'));
  const userData = `--user-data-dir=${join(directory, 'user-data')}`;
  // CI machines have small screens, and a window never grows beyond its
  // screen. At half the device scale factor the screen holds the full
  // 1480 x 920 window, so every test sees the same layout. Documentation
  // screenshots keep the real scale.
  const scale = process.env['KOMA_SCREENSHOTS'] === '1' ? [] : ['--force-device-scale-factor=0.5'];
  const application = await electron.launch(
    options.executablePath === undefined
      ? {
          args: [APPLICATION_DIRECTORY, userData, ...scale],
          cwd: APPLICATION_DIRECTORY,
          env: getApplicationEnvironment(),
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
