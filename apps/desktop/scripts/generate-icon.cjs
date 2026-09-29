/**
 * Draws `build/icon.png` from `build/icon.svg`. Run it after changing the
 * drawing: `pnpm --filter @koma-motion/desktop icon`.
 *
 * electron-builder creates the Windows and macOS icon formats from the PNG.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const SIZE = 1024;
const TIMEOUT_MS = 20_000;
const directory = path.resolve(__dirname, '../build');

// The drawing is rendered off screen, at exactly one pixel per unit.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');

function renderOnce(window) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('The drawing was not rendered in time.'));
    }, TIMEOUT_MS);
    window.webContents.on('paint', (_event, _dirty, image) => {
      const { width, height } = image.getSize();
      if (width === SIZE && height === SIZE && !image.isEmpty()) {
        clearTimeout(timer);
        resolve(image);
      }
    });
  });
}

app.whenReady().then(async () => {
  try {
    const window = new BrowserWindow({
      width: SIZE,
      height: SIZE,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const drawing = await fs.readFile(path.join(directory, 'icon.svg'), 'utf8');
    const page =
      `<style>html,body{margin:0;width:${SIZE}px;height:${SIZE}px;overflow:hidden;` +
      `background:transparent}svg{display:block}</style>${drawing}`;
    const rendered = renderOnce(window);
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
    window.webContents.invalidate();
    const image = await rendered;
    await fs.writeFile(path.join(directory, 'icon.png'), image.toPNG());
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
