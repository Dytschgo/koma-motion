/**
 * Build configuration of the three parts of the desktop application.
 *
 * Koma Motion uses Vite directly instead of an Electron build framework: the
 * application consists of two small Node.js bundles (main process and preload
 * script) and one web bundle (renderer), which Vite builds without help.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const outDir = resolve(root, 'out');

/**
 * A bundle that runs in Node.js. Everything except Electron itself is
 * bundled, so the built application does not need `node_modules`.
 */
function nodeBundle(name, entry, mode) {
  return {
    configFile: false,
    root,
    mode,
    logLevel: 'warn',
    publicDir: false,
    build: {
      ssr: resolve(root, entry),
      outDir: resolve(outDir, name),
      emptyOutDir: true,
      target: 'node22',
      minify: false,
      sourcemap: mode === 'development',
      rolldownOptions: {
        external: ['electron'],
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs',
          codeSplitting: false,
        },
      },
    },
    ssr: {
      noExternal: true,
      external: ['electron'],
    },
  };
}

export function mainConfig(mode) {
  return nodeBundle('main', 'src/main/index.ts', mode);
}

export function preloadConfig(mode) {
  return nodeBundle('preload', 'src/preload/index.ts', mode);
}

export function deckPreloadConfig(mode) {
  return nodeBundle('deck-preload', 'src/preload/deckRender.ts', mode);
}

export function rendererConfig(mode) {
  return {
    configFile: false,
    root: resolve(root, 'src/renderer'),
    mode,
    logLevel: 'warn',
    // The application is served from the root of its own protocol.
    base: '/',
    plugins: [react(), tailwindcss()],
    build: {
      outDir: resolve(outDir, 'renderer'),
      emptyOutDir: true,
      target: 'chrome140',
      sourcemap: mode === 'development',
      // Images are embedded in projects, never in the application bundle.
      assetsInlineLimit: 0,
      rolldownOptions: {
        input: {
          main: resolve(root, 'src/renderer/index.html'),
          deck: resolve(root, 'src/renderer/deck-render.html'),
        },
      },
    },
  };
}
