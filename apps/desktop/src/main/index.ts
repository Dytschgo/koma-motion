import { join } from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { ipcEvents } from '../shared/ipc';
import { hardenSession, hardenWebContents, registerAppScheme, serveApp } from './security';
import { createUpdateService, type UpdateService } from './updates/service';
import { createMainWindow } from './window';

registerAppScheme();

// Every web contents, whoever creates it, gets the same restrictions.
app.on('web-contents-created', (_event, contents) => {
  hardenWebContents(contents);
});

let updates: UpdateService | null = null;

app.on('window-all-closed', () => {
  // The application has one window and one project: closing it ends the application.
  updates?.dispose();
  app.quit();
});

void app.whenReady().then(async () => {
  hardenSession(session.defaultSession);
  serveApp(join(__dirname, '../renderer'));

  const service = await createUpdateService((status) => {
    const payload = ipcEvents['koma:updates:status'].parse(status);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('koma:updates:status', payload);
      }
    }
  });
  updates = service;
  createMainWindow(service);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(service);
    }
  });
});
