import { basename, join } from 'node:path';
import { app, BrowserWindow, dialog, Menu, type MenuItemConstructorOptions } from 'electron';
import { ipcEvents } from '../shared/ipc';
import { registerHandlers } from './ipc/registerHandlers';
import { APP_URL, hardenWebContents } from './security';
import type { BrandKitLibrary } from './services/brandKitLibrary';
import { createProjectSession } from './services/projectFiles';
import type { UpdateService } from './updates/service';

const APPLICATION_NAME = 'Koma Motion';
/** Matches the background of the interface, so the window does not flash while it loads. */
const WINDOW_BACKGROUND = '#15181D';

const CLOSE_CHOICES = { save: 0, discard: 1, cancel: 2 } as const;

function buildMenu(): Menu {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } satisfies MenuItemConstructorOptions] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged
          ? []
          : [
              { type: 'separator' } satisfies MenuItemConstructorOptions,
              { role: 'toggleDevTools' } satisfies MenuItemConstructorOptions,
            ]),
      ],
    },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}

export function createMainWindow(
  updates: UpdateService,
  brandKits: BrandKitLibrary,
): BrowserWindow {
  const window = new BrowserWindow({
    title: APPLICATION_NAME,
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 700,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    // Packaged builds carry their icon in the executable. This is for development.
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  Menu.setApplicationMenu(buildMenu());
  hardenWebContents(window.webContents);

  const session = createProjectSession();
  let closeConfirmed = false;
  let askingToClose = false;

  const updateTitle = (): void => {
    if (window.isDestroyed()) {
      return;
    }
    const name = session.filePath === null ? 'Untitled' : basename(session.filePath);
    window.setTitle(
      `${name}${session.hasUnsavedChanges ? ' (unsaved changes)' : ''} - ${APPLICATION_NAME}`,
    );
    window.setDocumentEdited(session.hasUnsavedChanges);
  };

  const handlers = registerHandlers({
    window,
    session,
    updates,
    brandKits,
    closeConfirmed: () => {
      closeConfirmed = true;
      window.close();
    },
    projectStateChanged: updateTitle,
  });

  // The title is managed here, not by the page.
  window.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  window.on('close', (event) => {
    if (closeConfirmed || !session.hasUnsavedChanges) {
      return;
    }
    event.preventDefault();
    if (askingToClose) {
      return;
    }
    askingToClose = true;
    void dialog
      .showMessageBox(window, {
        type: 'warning',
        title: APPLICATION_NAME,
        message: 'Do you want to save the changes to this project?',
        detail: 'Your changes are lost if you do not save them.',
        buttons: ['Save', 'Do not save', 'Cancel'],
        defaultId: CLOSE_CHOICES.save,
        cancelId: CLOSE_CHOICES.cancel,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === CLOSE_CHOICES.save) {
          // Remember which project asked to be saved. A confirm for a later
          // project, or for a project that still has unsaved edits, does not close.
          session.saveAndCloseSessionId = session.sessionId;
          window.webContents.send(
            'koma:app:save-and-close',
            ipcEvents['koma:app:save-and-close'].parse({}),
          );
        } else if (response === CLOSE_CHOICES.discard) {
          closeConfirmed = true;
          window.close();
        }
      })
      .finally(() => {
        askingToClose = false;
      });
  });

  // The presentation player shows whether the window is full screen, however it got there.
  const reportFullScreen = (): void => {
    if (!window.isDestroyed()) {
      window.webContents.send(
        'koma:app:full-screen',
        ipcEvents['koma:app:full-screen'].parse({ fullScreen: window.isFullScreen() }),
      );
    }
  };
  window.on('enter-full-screen', reportFullScreen);
  window.on('leave-full-screen', reportFullScreen);

  window.on('closed', () => {
    handlers.dispose();
  });

  window.once('ready-to-show', () => {
    updateTitle();
    window.show();
  });

  void window.loadURL(APP_URL);
  return window;
}
