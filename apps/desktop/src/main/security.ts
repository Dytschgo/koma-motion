/**
 * The security boundary of the application. See SECURITY.md and
 * ARCHITECTURE.md for the reasoning behind each measure.
 */
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  app,
  protocol,
  shell,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents,
} from 'electron';
import {
  APP_SCHEME,
  CONTENT_SECURITY_POLICY,
  CONTENT_TYPES,
  isAllowedExternalLink,
  isAppUrl,
  resolveAppFile,
} from './securityPolicy';

export { APP_URL } from './securityPolicy';

/** Must run before the application is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false },
    },
  ]);
}

/** Serves the renderer bundle, and nothing else, through the application protocol. */
export function serveApp(rendererDirectory: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const file = request.method === 'GET' ? resolveAppFile(request.url, rendererDirectory) : null;
    if (file === null) {
      return new Response('Not found', { status: 404 });
    }
    try {
      const body = await readFile(file);
      return new Response(new Uint8Array(body), {
        status: 200,
        headers: {
          'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'Content-Security-Policy': CONTENT_SECURITY_POLICY,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function isAllowedRequest(url: string): boolean {
  return (
    isAppUrl(url) ||
    url.startsWith('data:') ||
    // Developer tools are only available in development builds.
    (!app.isPackaged && url.startsWith('devtools:'))
  );
}

/** Denies permissions and blocks every request that does not belong to the application. */
export function hardenSession(session: Session): void {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url) });
  });
}

/** Keeps web contents on the application page and out of new windows. */
export function hardenWebContents(contents: WebContents): void {
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
    }
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
    }
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalLink(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

/**
 * Accepts requests only from the top-level frame of the given web contents,
 * and only while it shows the application page.
 */
export function isTrustedSender(event: IpcMainInvokeEvent, expected: WebContents): boolean {
  const frame = event.senderFrame;
  return (
    frame !== null &&
    event.sender === expected &&
    frame === expected.mainFrame &&
    isAppUrl(frame.url)
  );
}
