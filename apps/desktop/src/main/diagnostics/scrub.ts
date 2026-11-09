/**
 * Prepares text for the diagnostics log: credentials are redacted and file
 * paths are reduced to what a maintainer needs.
 *
 * A path names its owner (`C:\Users\<name>`) and often the subject of a
 * project. Paths inside the application and its data folder keep their inner
 * part, because that names code and files of Koma Motion. Every other path
 * keeps only a well-known file extension.
 *
 * This is pattern matching, and it prefers to remove too much. A file name
 * may contain spaces, quotes and almost any other character, so the end of a
 * path cannot be found reliably: a path in quotes is removed up to the last
 * such quote on its line, and a path without quotes is removed to the end of
 * its line. Text that does not start like an absolute path is not recognised
 * as one.
 */
import { redactDiagnostics } from '@koma-motion/agent-runtime/node';

export interface ScrubLocations {
  /** The application bundle. Inner paths are kept: they name code. */
  readonly app?: string;
  /** The private data folder of the application. Inner paths are kept. */
  readonly userData?: string;
  readonly temp?: string;
  readonly home?: string;
}

export type Scrubber = (text: string, maxLength?: number) => string;

const SEPARATOR = String.raw`[\\/]+`;
/** Not part of a URL, a module name, a placeholder or a longer word. */
const NOT_INSIDE = String.raw`(?<![\w.:/<>~\\-])`;
/**
 * Where an absolute path starts outside quotes: a drive (not the `a:` of
 * `koma://`), a network share written with backslashes or slashes, the root
 * of macOS and Linux, or the home sign.
 */
const BARE_START =
  String.raw`(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/]` +
  String.raw`|(?<![\\\w>])\\\\+[^\\/\s"']` +
  String.raw`|${NOT_INSIDE}//[^/\s"']` +
  String.raw`|${NOT_INSIDE}/[^\s/\\"'*]` +
  String.raw`|${NOT_INSIDE}~[\\/])`;
/** The same directly after an opening quote, where nothing can precede it. */
const QUOTED_START = String.raw`(?:[A-Za-z]:[\\/]|\\\\|/[^\s*]|~[\\/])`;
const PATH = new RegExp(
  String.raw`(["'])(?=${QUOTED_START})([^\r\n]*)\1|(${BARE_START}[^\r\n]*)`,
  'g',
);
const FILE_URL = /file:\/\/(?=\/)/gi;
const EXTENSION = /\.([A-Za-z0-9]{1,8})$/;
/**
 * Extensions that say what kind of file failed. Any other ending could be
 * part of a name (`C:\Users\j.smith`) and is not shown.
 */
const KNOWN_EXTENSIONS = new Set([
  'koma',
  'json',
  'pptx',
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'txt',
  'md',
  'log',
  'tmp',
  'js',
  'cjs',
  'mjs',
  'node',
  'asar',
  'exe',
  'dll',
  'dmg',
  'zip',
  'yml',
  'yaml',
  'blockmap',
  'html',
  'css',
]);

function escapeExpression(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function partsOf(root: string): string[] {
  return root.split(/[\\/]+/).filter((part) => part.length > 0);
}

/** One spelling for comparison: single forward slashes, no trailing one, lower case. */
function normalise(path: string): string {
  return path
    .replace(/[\\/]+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}

/**
 * Matches a folder whose inner paths are kept, however its separators are
 * written. Only the whole name counts, directly followed by a separator or
 * the end of the path: `…\Koma Motion Backup` is another folder.
 */
function keptExpression(root: string): RegExp | null {
  const parts = partsOf(root);
  // A drive or a top-level folder alone is not a location worth naming.
  if (parts.length < 2) {
    return null;
  }
  const absolute = /^[\\/]/.test(root);
  return new RegExp(
    (absolute ? `${NOT_INSIDE}${SEPARATOR}` : String.raw`(?<![A-Za-z0-9<])`) +
      parts.map(escapeExpression).join(SEPARATOR) +
      String.raw`(?=[\\/"':)\r\n]|$)`,
    'gi',
  );
}

export function createScrubber(locations: ScrubLocations = {}): Scrubber {
  const kept = [
    { root: locations.app, placeholder: '<app>' },
    { root: locations.userData, placeholder: '<app-data>' },
  ]
    .flatMap(({ root, placeholder }) => {
      const expression = root === undefined ? null : keptExpression(root);
      return expression === null || root === undefined
        ? []
        : [{ expression, placeholder, length: root.length }];
    })
    // A folder inside another one is replaced first.
    .sort((first, second) => second.length - first.length);

  const reduced = [
    { root: locations.temp, placeholder: '<temp>' },
    { root: locations.home, placeholder: '<home>' },
  ]
    .flatMap(({ root, placeholder }) =>
      root === undefined || partsOf(root).length < 2
        ? []
        : [{ root: normalise(root), placeholder }],
    )
    .sort((first, second) => second.root.length - first.root.length);

  /** What remains of a path that is not shown: a marker and a known extension. */
  const reduce = (path: string): string => {
    const normalised = normalise(path);
    const known = reduced.find(
      ({ root }) => normalised === root || normalised.startsWith(`${root}/`),
    );
    const placeholder = known?.placeholder ?? '<path>';
    if (known?.root === normalised || /^[a-z]:$/.test(normalised)) {
      return placeholder;
    }
    const extension = EXTENSION.exec(path.trimEnd())?.[1]?.toLowerCase();
    return extension !== undefined && KNOWN_EXTENSIONS.has(extension)
      ? `${placeholder}/…/*.${extension}`
      : `${placeholder}/…`;
  };

  return (text, maxLength) => {
    let result = redactDiagnostics(text, maxLength).replace(FILE_URL, '');
    for (const { expression, placeholder } of kept) {
      result = result.replace(expression, placeholder);
    }
    return result.replace(
      PATH,
      (
        _match: string,
        quote: string | undefined,
        quoted: string | undefined,
        bare: string | undefined,
      ) => (quote === undefined ? reduce(bare ?? '') : `${quote}${reduce(quoted ?? '')}${quote}`),
    );
  };
}
