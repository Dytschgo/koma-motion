/**
 * Development mode: rebuilds the application when a source file changes and
 * restarts Electron.
 *
 * There is no development server. The development build is loaded exactly
 * like the production build, through the application protocol and with the
 * same Content Security Policy, so development never runs with weaker
 * security settings than production.
 */
import { build } from 'vite';
import { mainConfig, preloadConfig, deckPreloadConfig, rendererConfig } from './config.mjs';
import { startElectron } from './electron.mjs';

const RESTART_DELAY_MS = 150;
const mode = 'development';

let electron = null;
let restartTimer = null;
let stopping = false;
let ready = false;
let watchers = [];

function start() {
  const started = startElectron();
  electron = started;
  started.on('exit', () => {
    if (electron === started && !stopping) {
      // The window was closed by the user: end development mode.
      stop(0);
    }
  });
}

function restart() {
  if (!ready) {
    return;
  }
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    const previous = electron;
    electron = null;
    previous?.kill();
    start();
  }, RESTART_DELAY_MS);
}

async function watch(config) {
  const watcher = await build({ ...config, build: { ...config.build, watch: {} } });
  await new Promise((resolve, reject) => {
    watcher.on('event', (event) => {
      if (event.code === 'END') {
        resolve();
        restart();
      } else if (event.code === 'ERROR') {
        console.error(event.error);
        if (!ready) {
          reject(event.error);
        }
      }
    });
  });
  return watcher;
}

function stop(code) {
  stopping = true;
  clearTimeout(restartTimer);
  for (const watcher of watchers) {
    void watcher.close();
  }
  electron?.kill();
  process.exit(code);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

watchers = [
  await watch(mainConfig(mode)),
  await watch(preloadConfig(mode)),
  await watch(deckPreloadConfig(mode)),
  await watch(rendererConfig(mode)),
];
ready = true;
start();
console.log('Koma Motion is running. Changes rebuild and restart the application.');
