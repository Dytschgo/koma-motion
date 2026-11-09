/**
 * Prepares text for the diagnostics log: credentials are redacted and file
 * paths are reduced to what a maintainer needs.
 *
 * A path names its owner (`C:\Users\<name>`) and often the subject of a
 * project. Paths inside the application and its data folder keep their inner
 * part, because that names code and files of Koma Motion. Every other path
 * keeps only its file extension.
 *
 * This is pattern matching. A path without quotes that contains spaces is
 * cut generously, to the end of its line, but text that does not look like a
 * path is not recognised as one.
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
/** One part of a path: anything but separators, quotes, line breaks and reserved characters. */
const SEGMENT = String.raw`[^\\/"'\r\n<>|*?:]+`;
const REMAINDER = `((?:${SEPARATOR}${SEGMENT})*)`;

/** `C:\…`, also with doubled backslashes as in JSON. Not the `a:` of `koma://`. */
const WINDOWS_PATH = new RegExp(
  String.raw`(?<![A-Za-z0-9<])[A-Za-z]:((?:${SEPARATOR}${SEGMENT})+)`,
  'g',
);
const UNC_PATH = new RegExp(
  String.raw`(?<![\\\w:>])\\\\[^\\/"'\s<>|*?:]+((?:\\+${SEGMENT})+)`,
  'g',
);
/** Absolute paths below the usual roots of macOS and Linux. Not the path of a URL. */
const POSIX_PATH = new RegExp(
  String.raw`(?<![\w.:/<>~-])/(?:Users|home|root|Volumes|private|var|tmp|mnt|media|opt|Applications|Library|usr|etc)\b` +
    String.raw`((?:/[^\\/"'\r\n<>|*?:]+)*)`,
  'g',
);
const FILE_URL = /file:\/\/(?=\/)/gi;
const EXTENSION = /\.[A-Za-z0-9]{1,8}$/;

function escapeExpression(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** Matches a folder however its separators are written, and only as a whole name. */
function rootExpression(root: string, remainder: boolean): RegExp | null {
  const parts = root.split(/[\\/]+/).filter((part) => part.length > 0);
  // A drive or a top-level folder alone is not a location worth naming.
  if (parts.length < 2) {
    return null;
  }
  const absolute = /^[\\/]/.test(root);
  const body = parts.map(escapeExpression).join(SEPARATOR);
  return new RegExp(
    (absolute ? String.raw`(?<![\w.:<>~-])${SEPARATOR}` : String.raw`(?<![A-Za-z0-9<])`) +
      body +
      String.raw`(?![\w.~-])` +
      (remainder ? REMAINDER : ''),
    'gi',
  );
}

/** What remains of a path that is not shown: a marker and the file extension. */
function collapse(placeholder: string, remainder: string): string {
  if (remainder.replace(/[\\/]/g, '').length === 0) {
    return placeholder;
  }
  const extension = EXTENSION.exec(remainder.trimEnd())?.[0];
  return extension === undefined ? `${placeholder}/…` : `${placeholder}/…/*${extension}`;
}

export function createScrubber(locations: ScrubLocations = {}): Scrubber {
  const roots = [
    { root: locations.app, placeholder: '<app>', keep: true },
    { root: locations.userData, placeholder: '<app-data>', keep: true },
    { root: locations.temp, placeholder: '<temp>', keep: false },
    { root: locations.home, placeholder: '<home>', keep: false },
  ]
    .flatMap(({ root, placeholder, keep }) => {
      const expression = root === undefined ? null : rootExpression(root, !keep);
      return expression === null || root === undefined
        ? []
        : [{ expression, placeholder, keep, length: root.length }];
    })
    // A folder inside another one is replaced first.
    .sort((first, second) => second.length - first.length);

  return (text, maxLength) => {
    let result = redactDiagnostics(text, maxLength).replace(FILE_URL, '');
    for (const { expression, placeholder, keep } of roots) {
      result = result.replace(expression, (_match, remainder: unknown) =>
        keep ? placeholder : collapse(placeholder, typeof remainder === 'string' ? remainder : ''),
      );
    }
    return result
      .replace(WINDOWS_PATH, (_match, remainder: string) => collapse('<path>', remainder))
      .replace(UNC_PATH, (_match, remainder: string) => collapse('<path>', remainder))
      .replace(POSIX_PATH, (_match, remainder: string) => collapse('<path>', remainder));
  };
}
