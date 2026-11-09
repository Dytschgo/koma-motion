import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DiagnosticsLog,
  LOG_FILE_NAME,
  MAX_ENTRY_BYTES,
  PREVIOUS_LOG_FILE_NAME,
  type DiagnosticValue,
} from './log';
import { TokenBucket } from './rateLimit';
import { createScrubber } from './scrub';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function setup(options: { maxFileBytes?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'koma-log-'));
  roots.push(root);
  const directory = join(root, 'logs');
  const clock = { elapsed: 0 };
  const log = new DiagnosticsLog({
    directory,
    scrub: createScrubber({ home: 'C:\\Users\\Ada Lovelace', userData: join(root) }),
    now: () => new Date('2026-11-09T10:00:00.000Z'),
    elapsed: () => clock.elapsed,
    ...options,
  });
  const file = join(directory, LOG_FILE_NAME);
  const lines = (): Record<string, unknown>[] =>
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => {
        const entry: unknown = JSON.parse(line);
        if (typeof entry !== 'object' || entry === null) throw new Error('Not an entry');
        return { ...entry };
      });
  return {
    root,
    directory,
    file,
    previous: join(directory, PREVIOUS_LOG_FILE_NAME),
    log,
    lines,
    clock,
  };
}

describe('diagnostics log', () => {
  it('writes one JSON line per entry with time, level and event', () => {
    const { log, lines } = setup();
    log.write('info', 'app.start', { version: '0.3.0', packaged: true });
    log.write('error', 'window.renderer-gone', { reason: 'crashed', exitCode: 2 });
    expect(lines()).toEqual([
      {
        time: '2026-11-09T10:00:00.000Z',
        level: 'info',
        event: 'app.start',
        version: '0.3.0',
        packaged: true,
      },
      {
        time: '2026-11-09T10:00:00.000Z',
        level: 'error',
        event: 'window.renderer-gone',
        reason: 'crashed',
        exitCode: 2,
      },
    ]);
  });

  it('redacts credentials and personal paths in every text it is given', () => {
    const { log, file } = setup();
    log.write('error', 'main.uncaught-exception', {
      message:
        "EPERM: open 'C:\\Users\\Ada Lovelace\\Documents\\Merger plan.koma' with Authorization: Bearer abcdefghijklmnop and sk-abcdefghijklmnopqrstuvwxyz",
      nested: { list: ['api_key=supersecretvalue', 'D:\\Clients\\Acme\\deck.koma'] },
    });
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain('Ada');
    expect(text).not.toContain('Merger plan');
    expect(text).not.toContain('Acme');
    expect(text).not.toContain('abcdefghijklmnop');
    expect(text).not.toContain('supersecretvalue');
    expect(text).toContain('<home>/…/*.koma');
    expect(text).toContain('<path>/…/*.koma');
    expect(text).toContain('[redacted]');
  });

  it('keeps text from outside inside its own entry', () => {
    const { log, lines, file } = setup();
    log.write('error', 'renderer.error', {
      stack: 'at a\n{"time":"2020-01-01T00:00:00.000Z","level":"info","event":"app.start"}',
      time: 'forged',
      event: 'forged',
    });
    expect(readFileSync(file, 'utf8').trimEnd().split('\n')).toHaveLength(1);
    expect(lines()[0]).toMatchObject({
      time: '2026-11-09T10:00:00.000Z',
      event: 'renderer.error',
      'data.time': 'forged',
      'data.event': 'forged',
    });
  });

  it('bounds one entry, deep values and long lists', () => {
    const { log, lines, file } = setup();
    let deep: DiagnosticValue = 'bottom';
    for (let level = 0; level < 10; level += 1) deep = { deep };
    log.write('info', 'bounded', {
      deep,
      list: Array.from({ length: 100 }, (_, index) => index),
      long: 'word '.repeat(2000),
      notFinite: Number.NaN,
    });
    const [entry] = lines();
    expect(JSON.stringify(entry)).toContain('[nested]');
    expect(entry?.['list']).toHaveLength(24);
    expect(String(entry?.['long']).length).toBeLessThan(2100);
    expect(entry?.['notFinite']).toBeNull();

    const many: Record<string, string> = {};
    for (let index = 0; index < 24; index += 1) many[`field${String(index)}`] = 'x '.repeat(900);
    log.write('info', 'too-large', many);
    expect(lines()[1]).toEqual({
      time: '2026-11-09T10:00:00.000Z',
      level: 'info',
      event: 'too-large',
      truncated: true,
    });
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      expect(Buffer.byteLength(line) + 1).toBeLessThanOrEqual(MAX_ENTRY_BYTES);
    }
  });

  it('rotates into one previous file and never grows beyond its limit', () => {
    const maxFileBytes = 32 * 1024;
    const { log, file, previous, directory, clock } = setup({ maxFileBytes });
    for (let index = 0; index < 600; index += 1) {
      // Time passes, so the rate limit does not hide the size limit.
      clock.elapsed += 1000;
      log.write('info', 'entry', { index, filler: 'x'.repeat(300) });
      expect(statSync(file).size).toBeLessThanOrEqual(maxFileBytes);
    }
    expect(readdirSync(directory).sort()).toEqual([LOG_FILE_NAME, PREVIOUS_LOG_FILE_NAME].sort());
    expect(statSync(previous).size).toBeLessThanOrEqual(maxFileBytes);
    // The newest entry is in the current file, older ones moved on.
    expect(readFileSync(file, 'utf8')).toContain('"index":599');
    expect(readFileSync(file, 'utf8')).not.toContain('"index":0,');
    expect(readFileSync(previous, 'utf8')).not.toContain('"index":0,');
  });

  it('continues an existing log and rotates one that is already too large', () => {
    const { log, file, previous, directory } = setup({ maxFileBytes: 32 * 1024 });
    mkdirSync(directory, { recursive: true });
    writeFileSync(file, `${'old '.repeat(10_000)}\n`);
    log.write('info', 'after-start');
    expect(readFileSync(previous, 'utf8')).toContain('old old');
    expect(readFileSync(file, 'utf8').trimEnd().split('\n')).toHaveLength(1);
  });

  it('returns the newest entries from both files, starting at a whole line', () => {
    const { log, clock } = setup({ maxFileBytes: 32 * 1024 });
    expect(log.tail(1000)).toBe('');
    for (let index = 0; index < 150; index += 1) {
      clock.elapsed += 1000;
      log.write('info', 'entry', { index, filler: 'x'.repeat(300) });
    }
    const tail = log.tail(40 * 1024);
    expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(40 * 1024);
    const entries = tail.trimEnd().split('\n');
    expect(() => entries.map((line): unknown => JSON.parse(line))).not.toThrow();
    expect(entries.at(-1)).toContain('"index":149');
    // More than the current file holds: the previous file continues it without a gap.
    const indexes = entries.map((line) => Number(/"index":(\d+)/.exec(line)?.[1]));
    expect(indexes).toEqual(indexes.map((_, position) => (indexes[0] ?? 0) + position));
    expect(indexes.length).toBeGreaterThan(90);
  });

  it('never throws when it cannot write, and writes again once it can', () => {
    const { log, directory, file, lines, clock } = setup();
    // A file where the folder should be: nothing can be created below it.
    writeFileSync(directory, 'in the way');
    expect(() => log.write('error', 'lost-1')).not.toThrow();
    expect(() => log.write('fatal', 'lost-2')).not.toThrow();
    expect(log.tail(1000)).toBe('');

    rmSync(directory);
    // Too early: the failed log is left alone for a while.
    log.write('error', 'lost-3');
    expect(() => statSync(file)).toThrow();
    clock.elapsed += 31_000;
    log.write('info', 'back');
    expect(lines()).toEqual([
      expect.objectContaining({ level: 'warn', event: 'log.entries-missed', count: 3 }),
      expect.objectContaining({ level: 'info', event: 'back' }),
    ]);
  });

  it('refuses a log file that is not a regular file', () => {
    const { log, directory, file } = setup();
    mkdirSync(file, { recursive: true });
    expect(() => log.write('info', 'entry')).not.toThrow();
    expect(readdirSync(directory)).toEqual([LOG_FILE_NAME]);
    expect(readdirSync(file)).toEqual([]);
  });

  it('limits a flood of entries, reports how many were left out and lets a fatal entry through', () => {
    const { log, lines, clock } = setup();
    for (let index = 0; index < 1000; index += 1) log.write('error', 'flood', { index });
    expect(lines()).toHaveLength(200);
    log.write('fatal', 'main.uncaught-exception');
    expect(lines().slice(-2)).toEqual([
      expect.objectContaining({ event: 'log.entries-missed', count: 800 }),
      expect.objectContaining({ level: 'fatal', event: 'main.uncaught-exception' }),
    ]);
    clock.elapsed += 5000;
    for (let index = 0; index < 1000; index += 1) log.write('error', 'flood', { index });
    expect(lines().filter((entry) => entry['event'] === 'flood')).toHaveLength(205);
  });
});

describe('TokenBucket', () => {
  it('allows a burst, then one action per interval, and ignores a clock that goes back', () => {
    const bucket = new TokenBucket(2, 1000);
    expect([bucket.take(0), bucket.take(0), bucket.take(0)]).toEqual([true, true, false]);
    expect(bucket.take(999)).toBe(false);
    expect(bucket.take(1000)).toBe(true);
    expect(bucket.take(500)).toBe(false);
    expect(bucket.take(60_000)).toBe(true);
    expect([bucket.take(60_000), bucket.take(60_000)]).toEqual([true, false]);
  });
});
