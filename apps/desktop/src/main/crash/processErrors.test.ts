import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createUpdateStatusRecorder, createUpdaterLogger } from '../updates/updateLog';
import { createProcessErrorHandlers } from './processErrors';

const written = vi.hoisted(() => [] as { level: string; event: string; data: unknown }[]);

vi.mock('electron', () => ({ app: {}, dialog: {} }));
vi.mock('../diagnostics', () => ({
  diagnostics: {
    write: (level: string, event: string, data: unknown) => {
      written.push({ level, event, data });
    },
  },
}));

beforeEach(() => {
  written.length = 0;
});

describe('errors of the main process that nothing handled', () => {
  it('logs an uncaught exception, tells the user once and exits with code 1', () => {
    const calls: string[] = [];
    const handlers = createProcessErrorHandlers({
      notify: (title, text) => {
        calls.push(`notify:${title}`);
        expect(text).toContain('offered for recovery as an unsaved copy');
      },
      exit: (code) => calls.push(`exit:${String(code)}`),
    });
    handlers.uncaughtException(new RangeError('Broken invariant'));
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      level: 'fatal',
      event: 'main.uncaught-exception',
      data: { error: 'RangeError', message: 'Broken invariant' },
    });
    // Logged before the message that may block, exited after it.
    expect(calls).toEqual(['notify:Koma Motion has to close', 'exit:1']);
    // A further error while the process ends starts nothing new.
    handlers.uncaughtException(new Error('again'));
    expect(calls).toHaveLength(2);
    expect(written).toHaveLength(1);
  });

  it('exits even when telling the user fails', () => {
    const exit = vi.fn();
    const handlers = createProcessErrorHandlers({
      notify: () => {
        throw new Error('no display');
      },
      exit,
    });
    expect(() => handlers.uncaughtException(new Error('first'))).not.toThrow();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('logs an unhandled rejection and keeps running', () => {
    const notify = vi.fn();
    const exit = vi.fn();
    const handlers = createProcessErrorHandlers({ notify, exit });
    handlers.unhandledRejection(new Error('Background task failed'));
    handlers.unhandledRejection('not an error');
    expect(written.map((entry) => [entry.level, entry.event])).toEqual([
      ['error', 'main.unhandled-rejection'],
      ['error', 'main.unhandled-rejection'],
    ]);
    expect(notify).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('updating in the diagnostics log', () => {
  const log = {
    write: (level: string, event: string, data: unknown) => {
      written.push({ level, event, data });
    },
  };

  it('passes on what the native updater reports, by level', () => {
    const logger = createUpdaterLogger(log);
    logger.info('Checking for update');
    logger.warn(undefined);
    logger.error(new Error('sha512 checksum mismatch'));
    expect(written.slice(0, 2)).toEqual([
      { level: 'info', event: 'updater.message', data: { message: 'Checking for update' } },
      { level: 'warn', event: 'updater.message', data: { message: '[undefined]' } },
    ]);
    expect(written[2]).toMatchObject({ level: 'error', event: 'updater.message' });
    expect(JSON.stringify(written[2]?.data)).toContain('Error: sha512 checksum mismatch\\n');
    expect(written).toHaveLength(3);
    expect('debug' in logger).toBe(false);
  });

  it('records a change of state once, without download progress or the update command', () => {
    const record = createUpdateStatusRecorder(log);
    const base = { channel: 'stable', currentVersion: '0.3.0' } as const;
    record({ ...base, state: 'checking' });
    record({ ...base, state: 'checking' });
    record({
      ...base,
      state: 'available',
      version: '0.3.1',
      terminalCommand: 'curl example | sh',
      releaseUrl: 'https://github.com/Dytschgo/koma-motion/releases/tag/v0.3.1',
    });
    record({ ...base, state: 'downloading', version: '0.3.1', percent: 10 });
    record({ ...base, state: 'downloading', version: '0.3.1', percent: 55 });
    record({ ...base, state: 'error', message: 'The update failed. Try again.' });
    expect(written).toMatchObject([
      { level: 'info', data: { state: 'checking', channel: 'stable' } },
      { level: 'info', data: { state: 'available', version: '0.3.1' } },
      { level: 'info', data: { state: 'downloading' } },
      { level: 'error', data: { state: 'error', message: 'The update failed. Try again.' } },
    ]);
    expect(JSON.stringify(written)).not.toMatch(/curl|percent|releaseUrl/);
  });
});
