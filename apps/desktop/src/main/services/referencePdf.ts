import { join } from 'node:path';
import { BrowserWindow, ipcMain, session, type Session } from 'electron';
import { z } from 'zod';
import { MAX_REFERENCE_TEXT_LENGTH } from '@koma-motion/agent-runtime';
import { hardenSession, hardenWebContents, isTrustedSender, serveApp } from '../security';

const INPUT_CHANNEL = 'koma:reference-pdf:input';
const FINISH_CHANNEL = 'koma:reference-pdf:finish';
const PDF_TIMEOUT_MS = 15_000;

/** Only errors with fixed messages from this module may be shown to the user. */
export class ReferencePdfError extends Error {}

const resultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('extracted'),
      text: z.string().max(MAX_REFERENCE_TEXT_LENGTH),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      status: z.literal('failed'),
      reason: z.enum(['invalid', 'password', 'pages', 'processing']),
    })
    .strict(),
]);

let referenceSession: Session | null = null;
function isolatedSession(): Session {
  if (referenceSession === null) {
    referenceSession = session.fromPartition('koma-reference-pdf', { cache: false });
    hardenSession(referenceSession);
    serveApp(join(__dirname, '../renderer'), referenceSession.protocol);
  }
  return referenceSession;
}

function failure(reason: 'invalid' | 'password' | 'pages' | 'processing'): ReferencePdfError {
  switch (reason) {
    case 'invalid':
      return new ReferencePdfError('The selected PDF is invalid. Export a new copy.');
    case 'password':
      return new ReferencePdfError(
        'The selected PDF is password protected. Export an unprotected copy.',
      );
    case 'pages':
      return new ReferencePdfError('A PDF reference may have at most 40 pages.');
    case 'processing':
      return new ReferencePdfError('The selected PDF could not be processed. Export a new copy.');
  }
}

/** PDF.js runs in a disposable sandbox; the renderer receives bytes, never a path. */
export async function extractReferencePdf(
  parent: BrowserWindow,
  bytes: Uint8Array,
): Promise<{ text: string; truncated: boolean }> {
  if (parent.isDestroyed()) throw new ReferencePdfError('The reference window was closed.');
  const worker = new BrowserWindow({
    show: false,
    webPreferences: {
      session: isolatedSession(),
      preload: join(__dirname, '../reference-pdf-preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  hardenWebContents(worker.webContents);
  const trusted = (event: Electron.IpcMainEvent) =>
    !worker.isDestroyed() &&
    isTrustedSender(event, worker.webContents) &&
    event.senderFrame?.url === 'koma://app/reference-pdf.html';
  let rejectRun: (reason: Error) => void = () => undefined;
  const onParentClosed = () => rejectRun(new ReferencePdfError('The reference window was closed.'));
  const timeout = setTimeout(
    () =>
      rejectRun(new ReferencePdfError('PDF text extraction took too long. Choose a smaller PDF.')),
    PDF_TIMEOUT_MS,
  );
  const onInput = (event: Electron.IpcMainEvent) => {
    if (trusted(event)) worker.webContents.send(INPUT_CHANNEL, bytes);
  };
  let onFinish: (event: Electron.IpcMainEvent, value: unknown) => void = () => undefined;
  try {
    return await new Promise((resolve, reject) => {
      rejectRun = reject;
      onFinish = (event, value) => {
        if (!trusted(event)) return;
        const result = resultSchema.safeParse(value);
        if (!result.success) {
          reject(failure('processing'));
        } else if (result.data.status === 'failed') {
          reject(failure(result.data.reason));
        } else {
          resolve({ text: result.data.text, truncated: result.data.truncated });
        }
      };
      ipcMain.on(INPUT_CHANNEL, onInput);
      ipcMain.on(FINISH_CHANNEL, onFinish);
      parent.once('closed', onParentClosed);
      worker.webContents.once('render-process-gone', () => reject(failure('processing')));
      if (parent.isDestroyed()) {
        onParentClosed();
        return;
      }
      void worker
        .loadURL('koma://app/reference-pdf.html')
        .catch(() => reject(failure('processing')));
    });
  } finally {
    clearTimeout(timeout);
    parent.removeListener('closed', onParentClosed);
    ipcMain.removeListener(INPUT_CHANNEL, onInput);
    ipcMain.removeListener(FINISH_CHANNEL, onFinish);
    if (!worker.isDestroyed()) worker.destroy();
  }
}
