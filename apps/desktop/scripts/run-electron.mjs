/** Runs a script with Electron: `node scripts/run-electron.mjs <script> [arguments]`. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { root } from './config.mjs';

const require = createRequire(import.meta.url);
const environment = { ...process.env };
// See scripts/electron.mjs for the reason.
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(require('electron'), process.argv.slice(2), {
  cwd: root,
  stdio: 'inherit',
  env: environment,
});
child.on('exit', (code) => {
  process.exit(code ?? 1);
});
