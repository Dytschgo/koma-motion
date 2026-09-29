/** Starts the application that `pnpm build` created. */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { outDir } from './config.mjs';
import { startElectron } from './electron.mjs';

if (!existsSync(resolve(outDir, 'main/index.cjs'))) {
  console.error('The application has not been built yet. Run "pnpm build" first.');
  process.exit(1);
}

startElectron(process.argv.slice(2)).on('exit', (code) => {
  process.exit(code ?? 0);
});
