/**
 * The rules of the security boundary that do not need Electron. They are
 * separate so that they can be tested without starting the application.
 */
import { extname, resolve, sep } from 'node:path';

export const APP_SCHEME = 'koma';
export const APP_ORIGIN = `${APP_SCHEME}://app`;
export const APP_URL = `${APP_ORIGIN}/index.html`;

/** Links that may be opened in the browser of the user. */
const EXTERNAL_LINK_PREFIXES = ['https://github.com/Dytschgo/koma-motion'] as const;

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

/**
 * Maps a URL of the application protocol to a file of the renderer bundle.
 * Returns `null` for everything that is outside the bundle.
 */
export function resolveAppFile(url: string, rendererDirectory: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== 'app') {
    return null;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\u0000') || pathname.includes('\\')) {
    return null;
  }
  const base = resolve(rendererDirectory);
  const target = resolve(base, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    return null;
  }
  return CONTENT_TYPES[extname(target).toLowerCase()] === undefined ? null : target;
}

export function isAppUrl(url: string): boolean {
  return url.startsWith(`${APP_ORIGIN}/`);
}

export function isAllowedExternalLink(url: string): boolean {
  return EXTERNAL_LINK_PREFIXES.some(
    (prefix) => url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}#`),
  );
}
