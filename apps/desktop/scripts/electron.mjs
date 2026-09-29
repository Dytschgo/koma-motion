/** Starts Electron with the application in this folder. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { root } from './config.mjs';

const require = createRequire(import.meta.url);

/**
 * The environment for Electron. `ELECTRON_RUN_AS_NODE` is removed: tools that
 * are built with Electron set it for their child processes, and it would make
 * Electron start as plain Node.js instead of as the application.
 */
function getEnvironment() {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

export function startElectron(extraArguments = []) {
  // The `electron` package exports the path of the Electron executable.
  const electronPath = require('electron');
  return spawn(electronPath, ['.', ...extraArguments], {
    cwd: root,
    stdio: 'inherit',
    env: getEnvironment(),
  });
}
