/** Builds the desktop application for production into `out/`. */
import { build } from 'vite';
import { mainConfig, preloadConfig, deckPreloadConfig, rendererConfig } from './config.mjs';

const mode = 'production';

await build(mainConfig(mode));
await build(preloadConfig(mode));
await build(deckPreloadConfig(mode));
await build(rendererConfig(mode));

console.log('Built Koma Motion into apps/desktop/out');
