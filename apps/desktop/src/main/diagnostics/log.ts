/**
 * The diagnostics log: one bounded text file that only the main process
 * writes, in the private data folder of the application.
 *
 * Every entry is one line of JSON, so text from an untrusted source cannot
 * forge another entry. Text is scrubbed before it is written (see `scrub.ts`).
 * Callers pass technical facts only: never project contents, prompts,
 * reference text or credentials.
 *
 * Writing never throws. A log that cannot be written is dropped silently and
 * tried again later, because a failing log must not become a second failure.
 */
import {
  appendFileSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
} from 'node:fs';
import { join } from 'node:path';
import { TokenBucket } from './rateLimit';
import type { Scrubber } from './scrub';

export type DiagnosticLevel = 'info' | 'warn' | 'error' | 'fatal';
export type DiagnosticValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly DiagnosticValue[]
  | { readonly [key: string]: DiagnosticValue };
export type DiagnosticData = Readonly<Record<string, DiagnosticValue>>;

export interface Diagnostics {
  /** `event` is a fixed name such as `window.renderer-gone`, never text from outside. */
  write(level: DiagnosticLevel, event: string, data?: DiagnosticData): void;
}

export const LOG_FILE_NAME = 'koma-motion.log';
export const PREVIOUS_LOG_FILE_NAME = 'koma-motion.previous.log';
/** One file. With the previous file, the log takes at most twice this. */
export const MAX_LOG_FILE_BYTES = 512 * 1024;
export const MAX_ENTRY_BYTES = 8 * 1024;
const MAX_TEXT_LENGTH = 2000;
/** The lengths a text is cut to, tried in turn until the entry fits. */
const TEXT_LENGTHS = [MAX_TEXT_LENGTH, 400, 80] as const;
const MAX_DEPTH = 4;
const MAX_ITEMS = 24;
/** After a failed write, nothing is tried for this long. */
const RETRY_AFTER_MS = 30_000;
/** Entries at once, and how quickly another one becomes possible. */
const BURST = 200;
const REFILL_MS = 1000;

export interface DiagnosticsLogOptions {
  readonly directory: string;
  readonly scrub: Scrubber;
  readonly maxFileBytes?: number;
  /** The time of an entry. */
  readonly now?: () => Date;
  /** Milliseconds that never go backwards, for limits and retries. */
  readonly elapsed?: () => number;
}

export class DiagnosticsLog implements Diagnostics {
  readonly directory: string;
  private readonly file: string;
  private readonly previous: string;
  private readonly scrub: Scrubber;
  private readonly maxFileBytes: number;
  private readonly now: () => Date;
  private readonly elapsed: () => number;
  private readonly limit = new TokenBucket(BURST, REFILL_MS);
  /** Bytes in the current file. `null` until it is measured, and after a failure. */
  private size: number | null = null;
  private retryAt = 0;
  /** Entries that were not written since the last one that was. */
  private missed = 0;

  constructor(options: DiagnosticsLogOptions) {
    this.directory = options.directory;
    this.file = join(options.directory, LOG_FILE_NAME);
    this.previous = join(options.directory, PREVIOUS_LOG_FILE_NAME);
    this.scrub = options.scrub;
    this.maxFileBytes = Math.max(options.maxFileBytes ?? MAX_LOG_FILE_BYTES, MAX_ENTRY_BYTES * 2);
    this.now = options.now ?? (() => new Date());
    this.elapsed = options.elapsed ?? (() => performance.now());
  }

  write(level: DiagnosticLevel, event: string, data: DiagnosticData = {}): void {
    try {
      const elapsed = this.elapsed();
      // A fatal entry is the last one of a process. It is always attempted.
      if (level !== 'fatal' && (elapsed < this.retryAt || !this.limit.take(elapsed))) {
        this.missed += 1;
        return;
      }
      try {
        if (this.missed > 0) {
          this.append(this.format('warn', 'log.entries-missed', { count: this.missed }));
          this.missed = 0;
        }
        this.append(this.format(level, event, data));
      } catch {
        this.missed += 1;
        this.size = null;
        this.retryAt = elapsed + RETRY_AFTER_MS;
      }
    } catch {
      // Not even the clock worked. There is nothing left to report to.
    }
  }

  /**
   * The newest entries, at most `maxBytes` of them, oldest first. Empty when
   * nothing can be read.
   */
  tail(maxBytes: number): string {
    let text = '';
    for (const file of [this.file, this.previous]) {
      const remaining = maxBytes - Buffer.byteLength(text);
      if (remaining <= 0) {
        break;
      }
      text = readEnd(file, remaining) + text;
    }
    return text;
  }

  private format(level: DiagnosticLevel, event: string, data: DiagnosticData): string {
    const entry = { time: this.now().toISOString(), level, event };
    // An entry that is too long is written again with shorter texts, so that
    // what failed is still named. Only then is it reduced to a marker.
    for (const maxText of TEXT_LENGTHS) {
      const line = JSON.stringify({
        ...entry,
        ...this.clean(data, 0, maxText),
        ...(maxText === MAX_TEXT_LENGTH ? {} : { truncated: true }),
      });
      if (Buffer.byteLength(line) + 1 <= MAX_ENTRY_BYTES) {
        return `${line}\n`;
      }
    }
    return `${JSON.stringify({ ...entry, truncated: true })}\n`;
  }

  private clean(data: DiagnosticData, depth: number, maxText: number): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data).slice(0, MAX_ITEMS)) {
      // The entry's own fields cannot be replaced by data.
      const name = ['time', 'level', 'event'].includes(key) ? `data.${key}` : key;
      const cleaned = this.cleanValue(value, depth, maxText);
      if (cleaned !== undefined) {
        result[this.scrub(name, 80)] = cleaned;
      }
    }
    return result;
  }

  private cleanValue(value: DiagnosticValue, depth: number, maxText: number): unknown {
    if (typeof value === 'string') {
      return this.scrub(value, maxText);
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'boolean' || value === null || value === undefined) {
      return value;
    }
    if (depth >= MAX_DEPTH) {
      return '[nested]';
    }
    if (isList(value)) {
      return value
        .slice(0, MAX_ITEMS)
        .map((item) => this.cleanValue(item, depth + 1, maxText) ?? null);
    }
    return this.clean(value, depth + 1, maxText);
  }

  private append(line: string): void {
    const bytes = Buffer.byteLength(line);
    this.size ??= this.measure();
    if (this.size + bytes > this.maxFileBytes) {
      // Replaces the previous file, so the log never holds more than two.
      renameSync(this.file, this.previous);
      this.size = 0;
    }
    appendFileSync(this.file, line, { encoding: 'utf8', mode: 0o600 });
    this.size += bytes;
  }

  /** Creates the folder and returns the size of the current file. Refuses links. */
  private measure(): number {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (!lstatSync(this.directory).isDirectory()) {
      throw new Error('The log folder is not a folder.');
    }
    for (const file of [this.previous, this.file]) {
      const entry = lstatSync(file, { throwIfNoEntry: false });
      if (entry !== undefined && !entry.isFile()) {
        throw new Error('The log file is not a file.');
      }
      if (file === this.file) {
        return entry?.size ?? 0;
      }
    }
    return 0;
  }
}

function isList(value: DiagnosticValue): value is readonly DiagnosticValue[] {
  return Array.isArray(value);
}

/** A log that records nothing, for the time before the application has its folder. */
export const NO_DIAGNOSTICS: Diagnostics = { write: () => undefined };

/** The last `maxBytes` of a file, starting at the beginning of a line. */
function readEnd(file: string, maxBytes: number): string {
  try {
    const entry = lstatSync(file, { throwIfNoEntry: false });
    if (entry === undefined || !entry.isFile()) {
      return '';
    }
    const length = Math.min(entry.size, maxBytes);
    const buffer = Buffer.alloc(length);
    const handle = openSync(file, 'r');
    let read: number;
    try {
      read = readSync(handle, buffer, 0, length, entry.size - length);
    } finally {
      closeSync(handle);
    }
    const text = buffer.subarray(0, read).toString('utf8');
    // A cut file starts in the middle of an entry. That entry is left out.
    return length < entry.size ? text.slice(text.indexOf('\n') + 1) : text;
  } catch {
    return '';
  }
}
