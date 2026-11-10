import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchApplication,
  openSettingsPage,
  showInspector,
  type RunningApplication,
} from './application';

let running: RunningApplication;

test.beforeEach(async () => {
  running = await launchApplication();
});

test.afterEach(async () => {
  const testInfo = test.info();
  if (testInfo.status !== testInfo.expectedStatus) {
    // What the application recorded about the failure it was handling.
    const log = await readFile(
      join(running.directory, 'user-data', 'logs', 'koma-motion.log'),
      'utf8',
    ).catch(() => '');
    await testInfo.attach('koma-motion.log', { body: log, contentType: 'text/plain' });
  }
  await running.close();
});

const EDITED_TITLE = 'Edited before the failure';
/** Looks like a credential, so a leak into the log would also show that redaction was skipped. */
const INJECTED_MESSAGE = 'Injected failure quoting project text';

/** Creates a project and commits one edit that reaches the recovery snapshot. */
async function createAndEdit(window: Page): Promise<void> {
  await window.getByRole('button', { name: 'Create a project' }).first().click();
  await window.getByRole('button', { name: 'Add first Koma', exact: true }).click();
  await showInspector(window);
  await window.getByRole('tab', { name: 'Koma', exact: true }).click();
  await window.getByRole('textbox', { name: 'Title', exact: true }).fill(EDITED_TITLE);
  // The status alone can still describe the capture before this edit, so the file is read.
  await expect
    .poll(() =>
      readFile(join(running.directory, 'user-data', 'recovery', 'snapshot.json'), 'utf8').catch(
        () => '',
      ),
    )
    .toContain(EDITED_TITLE);
  await expect(window.getByText('Recovery snapshot saved', { exact: true })).toBeVisible();
}

async function readLogText(): Promise<string> {
  return readFile(join(running.directory, 'user-data', 'logs', 'koma-motion.log'), 'utf8');
}

async function readLog(): Promise<Record<string, unknown>[]> {
  return (await readLogText())
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const entry: unknown = JSON.parse(line);
      if (typeof entry !== 'object' || entry === null) throw new Error('Unexpected log line');
      return { ...entry };
    });
}

/**
 * Playwright's page object stays unusable after its renderer crashed, also
 * when the window has loaded again. The reloaded page is therefore read and
 * operated from the main process.
 */
function inReloadedPage(application: ElectronApplication, script: string): Promise<unknown> {
  return application.evaluate(async ({ BrowserWindow }, source) => {
    const contents = BrowserWindow.getAllWindows()[0]?.webContents;
    if (contents === undefined || contents.isCrashed() || contents.isLoading()) return null;
    const result: unknown = await contents.executeJavaScript(source, true);
    return result;
  }, script);
}

const clickButton = (name: string): string =>
  `(() => {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent.trim() === ${JSON.stringify(name)},
    );
    button?.click();
    return button !== undefined;
  })()`;

test('a crashed renderer is reported, reloaded on request and offers the unsaved work', async () => {
  const { window, application } = running;
  await createAndEdit(window);

  // Answer the native question with its first button and end the renderer process.
  const question = await application.evaluate(
    ({ dialog, BrowserWindow }) =>
      new Promise<{ message: string; detail: string; buttons: string[] }>((resolve) => {
        dialog.showMessageBox = (...parameters: unknown[]) => {
          const options = parameters.find(
            (value): value is { message: string; detail: string; buttons: string[] } =>
              typeof value === 'object' && value !== null && 'buttons' in value,
          );
          if (options !== undefined) {
            resolve({
              message: options.message,
              detail: options.detail,
              buttons: options.buttons,
            });
          }
          return Promise.resolve({ response: 0, checkboxChecked: false });
        };
        BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer();
      }),
  );
  expect(question.message).toBe('The Koma Motion window stopped working.');
  expect(question.detail).toContain('offered for recovery as an unsaved copy');
  expect(question.buttons).toEqual(['Reload window', 'Quit Koma Motion']);

  // The reloaded page starts with the existing recovery offer.
  await expect
    .poll(() => inReloadedPage(application, 'document.body.innerText'), { timeout: 20_000 })
    .toContain('Recover interrupted work');
  expect(await inReloadedPage(application, 'document.body.innerText')).toContain(
    'Untitled project has a recovery snapshot',
  );
  // The main process no longer remembers the lost page's project.
  expect(
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()),
  ).toBe('Untitled - Koma Motion');

  expect(await inReloadedPage(application, clickButton('Recover unsaved copy'))).toBe(true);
  await expect
    .poll(() =>
      inReloadedPage(
        application,
        `document.querySelector('[aria-label=${JSON.stringify(`Koma 1: ${EDITED_TITLE}`)}]') !== null`,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()),
    )
    .toBe('Untitled (unsaved changes) - Koma Motion');

  const log = await readLog();
  expect(log[0]).toMatchObject({ event: 'app.start', level: 'info', version: expect.any(String) });
  expect(log).toContainEqual(
    expect.objectContaining({
      event: 'window.renderer-gone',
      level: 'error',
      // Windows reports the ended process as crashed, macOS as killed.
      reason: expect.stringMatching(/^(crashed|killed)$/),
      expected: false,
      canReload: true,
    }),
  );
  expect(log).toContainEqual(
    expect.objectContaining({ event: 'window.renderer-gone-choice', choice: 'reload' }),
  );
  // The log never holds what the project contained.
  expect(await readLogText()).not.toContain(EDITED_TITLE);
});

test('a crash question that nobody answers does not keep the application from closing', async () => {
  const { window, application } = running;
  await createAndEdit(window);
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer();
  });
  await expect
    .poll(async () => (await readLog()).some((entry) => entry['event'] === 'window.renderer-gone'))
    .toBe(true);
  const closed = application.waitForEvent('close');
  await application.evaluate(({ app }) => {
    app.quit();
  });
  await closed;
  // The quit went the ordinary way: the question left the screen and nothing had to be forced.
  const events = (await readLog()).map((entry) => entry['event']);
  expect(events).toContain('window.quit-during-question');
  expect(events).not.toContain('window.question-stuck');
  expect(events).not.toContain('app.quit-forced');
  // The snapshot of the lost page is still there for the next start.
  const snapshot = await readFile(
    join(running.directory, 'user-data', 'recovery', 'snapshot.json'),
    'utf8',
  );
  expect(snapshot).toContain(EDITED_TITLE);
});

test('a render error shows a reload screen that leads to the recovery offer', async () => {
  const { window, application, problems } = running;
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 700);
  });
  await createAndEdit(window);

  // No production hook: the page's own ResizeObserver is replaced by one that
  // throws, and the chat creates an observer when it is shown again.
  await window.evaluate((message) => {
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: function BrokenObserver() {
        throw new Error(`${message} sk-abcdefghijklmnopqrstuvwxyz`);
      },
    });
  }, INJECTED_MESSAGE);
  await window.getByRole('button', { name: 'Hide the chat' }).click();
  await window.getByRole('button', { name: /^Show the chat/ }).click();

  const screen = window.getByRole('main', { name: 'Something went wrong' });
  await expect(screen).toBeVisible();
  await expect(screen.getByRole('alert').first()).toContainText('Reload the window to continue');
  await expect(screen).toContainText('offers to recover them as an unsaved copy');
  const reload = screen.getByRole('button', { name: 'Reload window', exact: true });
  await expect(reload).toBeFocused();
  await expect(reload).toBeInViewport({ ratio: 1 });
  await expect(screen.getByRole('button', { name: 'Open log folder' })).toBeInViewport({
    ratio: 1,
  });
  await window.screenshot({ path: test.info().outputPath('render-error-screen.png') });
  expect(problems.join('\n')).toContain(INJECTED_MESSAGE);

  // The failed interface cannot save, so closing must not ask it to.
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()),
    )
    .toBe('Untitled - Koma Motion');

  // Copying goes to the clipboard of the main process. The test keeps it off the real one.
  await application.evaluate(({ clipboard }) => {
    clipboard.writeText = (text: string) => {
      Reflect.set(globalThis, 'komaTestCopied', text);
      return Promise.resolve();
    };
  });
  await screen.getByRole('button', { name: 'Copy diagnostics' }).click();
  await expect(screen.getByRole('status')).toContainText('Diagnostics copied');
  const copied = await application.evaluate(() =>
    String(Reflect.get(globalThis, 'komaTestCopied')),
  );
  expect(copied).toContain('Koma Motion diagnostics');
  expect(copied).toContain('"event":"renderer.error"');

  const log = await readLog();
  const report = log.find((entry) => entry['event'] === 'renderer.error');
  expect(report).toMatchObject({ kind: 'render', level: 'error', error: 'Error' });
  expect(String(report?.['stack'])).toContain('at ');
  expect(String(report?.['componentStack'])).toContain('at ');
  // The class and the place of the error are logged. Its message is not.
  for (const text of [await readLogText(), copied]) {
    expect(text).not.toContain(INJECTED_MESSAGE);
    expect(text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(text).not.toContain(EDITED_TITLE);
  }

  await reload.click();
  const offer = window.getByRole('dialog', { name: 'Recover interrupted work' });
  await expect(offer).toContainText('Untitled project has a recovery snapshot');
  await offer.getByRole('button', { name: 'Recover unsaved copy' }).click();
  await expect(offer).not.toBeVisible();
  await expect(
    window
      .getByRole('list', { name: 'Komas' })
      .getByRole('button', { name: `Koma 1: ${EDITED_TITLE}`, exact: true }),
  ).toBeVisible();
  await expect(window.getByText('Unsaved changes', { exact: true })).toBeVisible();
});

test('Settings shows the diagnostics log and opens its folder without naming a path', async () => {
  const { window, application, problems } = running;
  await application.evaluate(({ BrowserWindow, shell }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 700);
    shell.openPath = (path: string) => {
      Reflect.set(globalThis, 'komaTestOpened', path);
      return Promise.resolve('');
    };
  });
  await window.getByRole('button', { name: 'Create a project' }).first().click();
  await openSettingsPage(window, 'About');
  const card = window.getByRole('region', { name: 'Diagnostics log' });
  await expect(card).toContainText('not your projects, requests or reference text');
  await card.getByRole('button', { name: 'Open log folder' }).scrollIntoViewIfNeeded();
  await window.screenshot({ path: test.info().outputPath('settings-diagnostics.png') });
  await card.getByRole('button', { name: 'Open log folder' }).click();
  await expect(card.getByRole('status')).toHaveText('The log folder is open.');
  const opened = await application.evaluate(() =>
    String(Reflect.get(globalThis, 'komaTestOpened')),
  );
  // macOS names its temporary folder through a link (/var for /private/var).
  expect(await realpath(opened)).toBe(await realpath(join(running.directory, 'user-data', 'logs')));

  // The channels take no input: a path or any other property is refused.
  const refused = await window.evaluate(async () => {
    const bridge: unknown = Reflect.get(window, 'komaMotion');
    const invoke: unknown =
      typeof bridge === 'object' && bridge !== null ? Reflect.get(bridge, 'invoke') : undefined;
    if (typeof invoke !== 'function') return ['no bridge'];
    const attempts: [string, unknown][] = [
      ['koma:diagnostics:open-folder', { path: 'C:/Windows' }],
      ['koma:diagnostics:copy', { text: 'anything' }],
      [
        'koma:diagnostics:report',
        { kind: 'render', name: 'E', stack: '', componentStack: '', message: 'x' },
      ],
      [
        'koma:diagnostics:report',
        { kind: 'render', name: 'E', stack: 'x'.repeat(4001), componentStack: '' },
      ],
      ['koma:diagnostics:read', {}],
    ];
    const outcomes: string[] = [];
    for (const [channel, payload] of attempts) {
      try {
        await Reflect.apply(invoke, bridge, [channel, payload]);
        outcomes.push('accepted');
      } catch {
        outcomes.push('refused');
      }
    }
    return outcomes;
  });
  expect(refused).toEqual(['refused', 'refused', 'refused', 'refused', 'refused']);

  // A window that reports without end fills at most a few entries.
  await window.evaluate(async () => {
    const bridge: unknown = Reflect.get(window, 'komaMotion');
    const invoke: unknown =
      typeof bridge === 'object' && bridge !== null ? Reflect.get(bridge, 'invoke') : undefined;
    if (typeof invoke !== 'function') return;
    for (let index = 0; index < 40; index += 1) {
      await Reflect.apply(invoke, bridge, [
        'koma:diagnostics:report',
        {
          kind: 'error',
          name: 'TypeError',
          stack: 'not a frame\nat somewhere (koma://app/x.js:1:1)',
          componentStack: '',
        },
      ]);
    }
  });
  const reports = (await readLog()).filter((entry) => entry['event'] === 'renderer.error');
  expect(reports).toHaveLength(5);
  expect(reports[0]).toMatchObject({ stack: 'at somewhere (koma://app/x.js:1:1)' });
  expect(problems).toEqual([]);
});
