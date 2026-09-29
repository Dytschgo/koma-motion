import { join } from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { hardenSession, hardenWebContents, registerAppScheme, serveApp } from './security';
import { createMainWindow } from './window';

registerAppScheme();

// Every web contents, whoever creates it, gets the same restrictions.
app.on('web-contents-created', (_event, contents) => {
  hardenWebContents(contents);
});

app.on('window-all-closed', () => {
  // The application has one window and one project: closing it ends the application.
  app.quit();
});

void app.whenReady().then(() => {
  hardenSession(session.defaultSession);
  serveApp(join(__dirname, '../renderer'));
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});
