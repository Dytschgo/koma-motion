import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('deckRenderer', {
  input: (): Promise<Uint8Array> =>
    ipcRenderer.invoke('koma:deck-render:input') as Promise<Uint8Array>,
  progress: (completed: number, total: number): void =>
    ipcRenderer.send('koma:deck-render:progress', { completed, total }),
  finish: (result: unknown): void => ipcRenderer.send('koma:deck-render:finish', result),
});
