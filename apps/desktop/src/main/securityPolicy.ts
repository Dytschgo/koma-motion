/**
 * The rules of the security boundary that do not need Electron. They are
 * separate so that they can be tested without starting the application.
 */
import { lstatSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const APP_SCHEME = 'koma';
export const APP_ORIGIN = `${APP_SCHEME}://app`;
export const APP_URL = `${APP_ORIGIN}/index.html`;

/**
 * Blocks WebRTC, including TCP and TURN, which CSP `connect-src` does not cover.
 * `response-origin` keeps bundled scripts, styles, fonts and images on `koma://app`.
 * `disable_non_proxied_udp` is not used: it still allows direct TCP.
 */
export const CONNECTION_ALLOWLIST = '(response-origin);webrtc=block';

/** Chromium feature that enforces `Connection-Allowlist`. Enabled before the app is ready. */
export const CONNECTION_ALLOWLIST_FEATURE = 'ConnectionAllowlists';

const REPOSITORY_HOST = 'github.com';
const REPOSITORY_PATH = '/Dytschgo/koma-motion';
/** Reserved Windows device names, with or without an extension. */
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * No remote content, no inline scripts, no `eval`. Inline style attributes
 * are required because elements are positioned with computed styles.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

function isWindowsDeviceName(segment: string): boolean {
  const trimmed = segment.replace(/[. ]+$/u, '');
  const stem = trimmed.split('.')[0] ?? '';
  return WINDOWS_DEVICE_NAME.test(stem);
}

/** Control characters, or any character in `forbidden`. */
function hasForbiddenCharacter(value: string, forbidden: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f || forbidden.includes(character)) {
      return true;
    }
  }
  return false;
}

/** Characters and forms that must never be passed to the Windows filesystem. */
function isRejectedPathSegment(segment: string): boolean {
  return (
    segment.length === 0 ||
    segment === '.' ||
    segment === '..' ||
    segment.endsWith('.') ||
    segment.endsWith(' ') ||
    segment.includes(':') ||
    isWindowsDeviceName(segment) ||
    hasForbiddenCharacter(segment, '\\<>"|?*')
  );
}

function isInsideDirectory(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Maps a URL of the application protocol to a file of the renderer bundle.
 * Returns `null` for everything that is outside the bundle, including a
 * junction or symlink that points out of it and a Windows alternate stream.
 */
export function resolveAppFile(url: string, rendererDirectory: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== `${APP_SCHEME}:` ||
    parsed.hostname !== 'app' ||
    parsed.port !== '' ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    return null;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  if (pathname !== '/' && segments.some((segment) => isRejectedPathSegment(segment))) {
    return null;
  }
  const base = resolve(rendererDirectory);
  const lexical = pathname === '/' ? join(base, 'index.html') : resolve(base, `.${pathname}`);
  if (!isInsideDirectory(base, lexical)) {
    return null;
  }
  if (CONTENT_TYPES[extname(lexical).toLowerCase()] === undefined) {
    return null;
  }

  let root: string;
  let canonical: string;
  try {
    root = realpathSync(base);
    let current = base;
    for (const segment of relative(base, lexical).split(sep)) {
      current = join(current, segment);
      // `lstat` sees the junction itself. `stat` would follow it and hide the escape.
      if (lstatSync(current).isSymbolicLink()) {
        return null;
      }
    }
    canonical = realpathSync(lexical);
  } catch {
    return null;
  }
  if (!isInsideDirectory(root, canonical)) {
    return null;
  }
  const canonicalRelative = relative(root, canonical);
  if (canonicalRelative.split(sep).some((segment) => isRejectedPathSegment(segment))) {
    return null;
  }
  return CONTENT_TYPES[extname(canonical).toLowerCase()] === undefined ? null : canonical;
}

export function isAppUrl(url: string): boolean {
  return url.startsWith(`${APP_ORIGIN}/`);
}

/**
 * The only URL the renderer may ask the operating system to open.
 * Returns the normalised https URL, or `null` when the destination is not
 * the project repository. The request is then made by the system browser.
 */
export function externalBrowserDestination(url: string): string | null {
  if (url.trim() !== url || hasForbiddenCharacter(url, '\\')) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== REPOSITORY_HOST) {
    return null;
  }
  if (
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.search !== ''
  ) {
    return null;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (pathname !== REPOSITORY_PATH && !pathname.startsWith(`${REPOSITORY_PATH}/`)) {
    return null;
  }
  if (
    pathname
      .split('/')
      .some(
        (segment) =>
          segment === '..' || segment === '.' || segment.includes('\\') || segment.includes(':'),
      )
  ) {
    return null;
  }
  return parsed.href;
}

export function isAllowedExternalLink(url: string): boolean {
  return externalBrowserDestination(url) !== null;
}
