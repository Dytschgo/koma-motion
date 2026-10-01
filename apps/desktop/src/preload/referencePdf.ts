import { contextBridge, ipcRenderer } from 'electron';

const INPUT_CHANNEL = 'koma:reference-pdf:input';
const FINISH_CHANNEL = 'koma:reference-pdf:finish';

contextBridge.exposeInMainWorld('referencePdf', {
  input: (): Promise<Uint8Array> =>
    new Promise((resolve) => {
      ipcRenderer.once(INPUT_CHANNEL, (_event, bytes: Uint8Array) => resolve(bytes));
      ipcRenderer.send(INPUT_CHANNEL);
    }),
  finish: (result: unknown): void => ipcRenderer.send(FINISH_CHANNEL, result),
});
