/**
 * Limits shared by IPC validation, serialisation and project files.
 * A project that passes them can be written and opened again.
 */

/** Largest `.koma` document, in UTF-8 bytes. Exactly 64 MiB. */
export const MAX_PROJECT_FILE_BYTES = 64 * 1024 * 1024;

const MAX_PROJECT_FILE_MB = MAX_PROJECT_FILE_BYTES / (1024 * 1024);

/** Shown when a project or file is above {@link MAX_PROJECT_FILE_BYTES}. */
export const PROJECT_TOO_LARGE_MESSAGE = `The project is larger than ${String(MAX_PROJECT_FILE_MB)} MB, which is the maximum size Koma Motion can save and open.`;

/** Nesting depth of unknown extension data. The value itself is depth 1. */
export const MAX_EXTENSION_DEPTH = 32;

/** Values visited while checking one extension property, including the root. */
export const MAX_EXTENSION_NODES = 10_000;

/** Properties allowed on one object in extension data, and unknown top-level properties. */
export const MAX_EXTENSION_OBJECT_KEYS = 1_000;

/** Characters allowed in one extension property name. */
export const MAX_EXTENSION_KEY_LENGTH = 256;

const EXTENSION_NOT_JSON =
  'Extension data must contain only JSON values: strings, finite numbers, booleans, null, arrays and objects.';

export interface ProjectLimitIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/**
 * True when the UTF-8 form of `text` is longer than `limit` bytes.
 * A JavaScript string length is a count of UTF-16 code units, so it is not
 * used as the file size.
 */
export function exceedsUtf8ByteLength(text: string, limit: number): boolean {
  if (limit < 0 || text.length > limit) {
    return true;
  }
  // Three bytes is the most UTF-8 uses for one UTF-16 code unit.
  if (text.length * 3 <= limit) {
    return false;
  }
  return utf8ByteLengthUntil(text, limit) > limit;
}

function utf8ByteLengthUntil(text: string, limit: number): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
    if (bytes > limit) {
      return bytes;
    }
  }
  return bytes;
}

interface ExtensionIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function notJson(path: readonly PropertyKey[]): ExtensionIssue {
  return { path, message: EXTENSION_NOT_JSON };
}

/**
 * Rejects extension values JSON cannot store, and values nested too deeply
 * or too widely to inspect safely. The walk is iterative so a deep value
 * cannot overflow the call stack.
 */
function findExtensionIssue(value: unknown): ExtensionIssue | null {
  const seen = new WeakSet<object>();
  const stack: Array<{
    readonly value: unknown;
    readonly depth: number;
    readonly path: PropertyKey[];
  }> = [{ value, depth: 1, path: [] }];
  let nodes = 0;

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) {
      break;
    }
    nodes += 1;
    if (nodes > MAX_EXTENSION_NODES) {
      return {
        path: frame.path,
        message: `Extension data has more than ${String(MAX_EXTENSION_NODES)} values.`,
      };
    }
    if (frame.depth > MAX_EXTENSION_DEPTH) {
      return {
        path: frame.path,
        message: `Extension data is nested more than ${String(MAX_EXTENSION_DEPTH)} levels deep.`,
      };
    }

    const { value: current, depth, path } = frame;
    if (current === null) {
      continue;
    }
    switch (typeof current) {
      case 'string':
      case 'boolean':
        continue;
      case 'number':
        if (!Number.isFinite(current)) {
          return notJson(path);
        }
        continue;
      case 'object':
        break;
      default:
        return notJson(path);
    }

    if (seen.has(current)) {
      return { path, message: 'Extension data cannot contain a circular reference.' };
    }
    seen.add(current);

    if (Array.isArray(current)) {
      if (
        current.length > MAX_EXTENSION_NODES ||
        Object.getOwnPropertySymbols(current).length > 0
      ) {
        return current.length > MAX_EXTENSION_NODES
          ? {
              path,
              message: `Extension data has more than ${String(MAX_EXTENSION_NODES)} values.`,
            }
          : notJson(path);
      }
      for (const key of Object.keys(current)) {
        if (!/^\d+$/.test(key)) {
          return notJson(path);
        }
      }
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current[index], depth: depth + 1, path: [...path, index] });
      }
      continue;
    }

    if (!isPlainObject(current) || Object.getOwnPropertySymbols(current).length > 0) {
      return notJson(path);
    }
    const keys = Object.keys(current);
    if (keys.length > MAX_EXTENSION_OBJECT_KEYS) {
      return {
        path,
        message: `Extension data has more than ${String(MAX_EXTENSION_OBJECT_KEYS)} properties.`,
      };
    }
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      if (key === undefined) {
        continue;
      }
      if (key.length > MAX_EXTENSION_KEY_LENGTH) {
        return {
          path: [...path, key],
          message: `Property names in extension data must be at most ${String(MAX_EXTENSION_KEY_LENGTH)} characters.`,
        };
      }
      stack.push({ value: current[key], depth: depth + 1, path: [...path, key] });
    }
  }

  return null;
}

/**
 * True when the strings in `value` already exceed `limit` UTF-8 bytes.
 * This is a lower bound of the file size, so it can reject a project before
 * the text is built. Structural JSON characters are checked separately.
 */
function contentExceedsByteLimit(value: unknown, limit: number): boolean {
  const seen = new WeakSet<object>();
  const stack: unknown[] = [value];
  let used = 0;

  const account = (text: string): boolean => {
    const remaining = limit - used;
    if (text.length > remaining) {
      return true;
    }
    const bytes = utf8ByteLengthUntil(text, remaining);
    if (bytes > remaining) {
      return true;
    }
    used += bytes;
    return false;
  };

  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === 'string') {
      if (account(current)) {
        return true;
      }
      continue;
    }
    if (typeof current !== 'object' || current === null) {
      continue;
    }
    if (seen.has(current)) {
      return true;
    }
    seen.add(current);
    if (Array.isArray(current)) {
      if (current.length > 1_000_000) {
        return true;
      }
      for (let index = 0; index < current.length; index += 1) {
        stack.push(current[index]);
      }
      continue;
    }
    if (!isPlainObject(current)) {
      return true;
    }
    const keys = Object.keys(current);
    if (keys.length > 1_000_000) {
      return true;
    }
    for (const key of keys) {
      if (account(key)) {
        return true;
      }
      stack.push(current[key]);
    }
  }

  return false;
}

function canonicalJsonExceedsByteLimit(value: unknown, limit: number): boolean {
  try {
    const serialised = JSON.stringify(value, null, 2);
    if (serialised === undefined) {
      return true;
    }
    return exceedsUtf8ByteLength(`${serialised}\n`, limit);
  } catch {
    return true;
  }
}

/**
 * The first size or extension-data problem in a project object, or `null`
 * when the unknown properties are JSON within the limits and the document
 * fits in the shared byte limit.
 */
export function findProjectLimitIssue(
  project: object,
  knownKeys: ReadonlySet<string>,
): ProjectLimitIssue | null {
  if (Object.getOwnPropertySymbols(project).length > 0) {
    return { path: [], message: EXTENSION_NOT_JSON };
  }

  const entries = Object.entries(project);
  const unknownEntries = entries.filter(([key]) => !knownKeys.has(key));
  if (unknownEntries.length > MAX_EXTENSION_OBJECT_KEYS) {
    return {
      path: [],
      message: `Extension data has more than ${String(MAX_EXTENSION_OBJECT_KEYS)} properties.`,
    };
  }

  for (const [key, value] of unknownEntries) {
    if (key.length > MAX_EXTENSION_KEY_LENGTH) {
      return {
        path: [key],
        message: `Property names in extension data must be at most ${String(MAX_EXTENSION_KEY_LENGTH)} characters.`,
      };
    }
    const issue = findExtensionIssue(value);
    if (issue !== null) {
      return { path: [key, ...issue.path], message: issue.message };
    }
  }

  if (
    contentExceedsByteLimit(project, MAX_PROJECT_FILE_BYTES) ||
    canonicalJsonExceedsByteLimit(project, MAX_PROJECT_FILE_BYTES)
  ) {
    return { path: [], message: PROJECT_TOO_LARGE_MESSAGE };
  }
  return null;
}
