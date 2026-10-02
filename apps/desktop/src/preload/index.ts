/**
 * The only code that connects the sandboxed renderer with the main process.
 *
 * It exposes two functions. Both accept nothing but the channel names listed
 * here, so the renderer cannot reach any other part of Electron.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// Kept as literals: a sandboxed preload script cannot share modules at runtime.
const API_KEY = 'komaMotion';

const REQUEST_CHANNELS: ReadonlySet<string> = new Set([
  'koma:references:select',
  'koma:export:validate',
  'koma:export:powerpoint',
  'koma:deck:capabilities',
  'koma:deck:prepare',
  'koma:deck:analyze',
  'koma:deck:cancel',
  'koma:deck:save',
  'koma:instruction-templates:list',
  'koma:instruction-templates:change',
  'koma:project:create',
  'koma:project:open',
  'koma:project:save',
  'koma:project:save-as',
  'koma:brand-kit:select-logo',
  'koma:project:select-image',
  'koma:brand-kits:list',
  'koma:brand-kits:create',
  'koma:brand-kits:update',
  'koma:brand-kits:rename',
  'koma:brand-kits:duplicate',
  'koma:brand-kits:delete',
  'koma:brand-kits:load',
  'koma:brand-kits:start-new',
  'koma:providers:detect',
  'koma:providers:list-models',
  'koma:providers:execute',
  'koma:providers:regenerate-transition',
  'koma:providers:cancel',
  'koma:app:set-unsaved-changes',
  'koma:app:confirm-close',
  'koma:app:set-full-screen',
  'koma:updates:get-status',
  'koma:updates:check',
  'koma:updates:set-channel',
  'koma:updates:download',
  'koma:updates:install',
  'koma:app:get-info',
]);

const EVENT_CHANNELS: ReadonlySet<string> = new Set([
  'koma:deck:progress',
  'koma:providers:status',
  'koma:providers:output',
  'koma:app:save-and-close',
  'koma:app:full-screen',
  'koma:updates:status',
]);

contextBridge.exposeInMainWorld(API_KEY, {
  invoke(channel: unknown, request: unknown): Promise<unknown> {
    if (typeof channel !== 'string' || !REQUEST_CHANNELS.has(channel)) {
      return Promise.reject(new Error('Unknown request'));
    }
    return ipcRenderer.invoke(channel, request);
  },

  subscribe(channel: unknown, listener: unknown): () => void {
    if (
      typeof channel !== 'string' ||
      !EVENT_CHANNELS.has(channel) ||
      typeof listener !== 'function'
    ) {
      throw new Error('Unknown event');
    }
    // The Electron event object never reaches the renderer.
    const forward = (_event: IpcRendererEvent, payload: unknown): void => {
      Reflect.apply(listener, undefined, [payload]);
    };
    ipcRenderer.on(channel, forward);
    return () => {
      ipcRenderer.removeListener(channel, forward);
    };
  },
});
