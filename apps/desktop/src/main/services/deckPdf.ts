import { join } from 'node:path';
import { BrowserWindow, ipcMain, session, type Session } from 'electron';
import { z } from 'zod';
import { renderedDeckSchema } from '../../shared/deckAnalysis';
import { hardenSession, isTrustedSender, serveApp } from '../security';

let renderingSession: Session | null = null;
function isolatedSession(): Session {
  if (renderingSession === null) {
    renderingSession = session.fromPartition('koma-deck-renderer', { cache: false });
    hardenSession(renderingSession);
    serveApp(join(__dirname, '../renderer'), renderingSession.protocol);
  }
  return renderingSession;
}

/** A crash or cancellation destroys only this disposable, sandboxed renderer. */
export async function renderDeckPdf(
  bytes: Uint8Array,
  signal: AbortSignal,
  progress: (completed: number, total: number) => void,
): Promise<z.infer<typeof renderedDeckSchema>> {
  signal.throwIfAborted();
  const worker = new BrowserWindow({
    show: false,
    webPreferences: {
      session: isolatedSession(),
      preload: join(__dirname, '../deck-preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    !worker.isDestroyed() && isTrustedSender(event, worker.webContents);
  let rejectRun: (reason: Error) => void = () => undefined;
  const abort = () => rejectRun(new Error('Deck processing was cancelled.'));
  const timeout = setTimeout(
    () =>
      rejectRun(
        new Error('Local deck processing exceeded 90 seconds. Export a smaller deck and retry.'),
      ),
    90000,
  );
  const onProgress = (event: Electron.IpcMainEvent, value: unknown) => {
    if (!trusted(event)) return;
    const result = z
      .object({
        completed: z.number().int().min(0).max(20),
        total: z.number().int().min(1).max(20),
      })
      .safeParse(value);
    if (result.success) progress(result.data.completed, result.data.total);
  };
  let onFinish: (event: Electron.IpcMainEvent, value: unknown) => void = () => undefined;
  try {
    return await new Promise((resolve, reject) => {
      rejectRun = reject;
      onFinish = (event, value) => {
        if (!trusted(event)) return;
        const failure = z.object({ error: z.string().max(500) }).safeParse(value);
        if (failure.success) {
          reject(new Error(failure.data.error));
          return;
        }
        const parsed = renderedDeckSchema.safeParse(value);
        if (!parsed.success) reject(new Error('The local renderer returned an invalid deck.'));
        else resolve(parsed.data);
      };
      ipcMain.handle('koma:deck-render:input', (event) => {
        if (!trusted(event)) throw new Error('Request rejected');
        return bytes;
      });
      ipcMain.on('koma:deck-render:progress', onProgress);
      ipcMain.on('koma:deck-render:finish', onFinish);
      worker.webContents.once('render-process-gone', () =>
        reject(new Error('The deck renderer stopped. Try a smaller or newly exported PDF.')),
      );
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      void worker
        .loadURL('koma://app/deck-render.html')
        .catch(() => reject(new Error('The local PDF renderer could not start.')));
    });
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    ipcMain.removeHandler('koma:deck-render:input');
    ipcMain.removeListener('koma:deck-render:progress', onProgress);
    ipcMain.removeListener('koma:deck-render:finish', onFinish);
    if (!worker.isDestroyed()) worker.destroy();
  }
}
