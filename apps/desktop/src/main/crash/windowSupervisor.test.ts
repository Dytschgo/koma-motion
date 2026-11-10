import { EventEmitter } from 'node:events';
import type { BrowserWindow, MessageBoxOptions } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { superviseWindow } from './windowSupervisor';

const electron = vi.hoisted(() => ({
  questions: [] as {
    options: MessageBoxOptions;
    answer: (response: number) => void;
  }[],
  appListeners: new Map<string, Set<() => void>>(),
  quits: 0,
}));
const written = vi.hoisted(() => [] as { level: string; event: string; data: unknown }[]);

vi.mock('electron', () => ({
  app: {
    quit: () => {
      electron.quits += 1;
    },
    on: (name: string, listener: () => void) => {
      electron.appListeners.set(name, (electron.appListeners.get(name) ?? new Set()).add(listener));
    },
    off: (name: string, listener: () => void) => {
      electron.appListeners.get(name)?.delete(listener);
    },
  },
  dialog: {
    showMessageBox: (_window: unknown, options: MessageBoxOptions) =>
      new Promise<{ response: number }>((resolve) => {
        const answer = (response: number): void => resolve({ response });
        // Like Electron: an aborted question answers with its cancel button.
        options.signal?.addEventListener('abort', () => answer(options.cancelId ?? 0));
        electron.questions.push({ options, answer });
      }),
  },
}));
vi.mock('../diagnostics', () => ({
  diagnostics: {
    write: (level: string, event: string, data: unknown) => {
      written.push({ level, event, data });
    },
  },
}));

function setup() {
  const contents = Object.assign(new EventEmitter(), {
    reload: vi.fn(),
    forcefullyCrashRenderer: vi.fn(),
  });
  let destroyed = false;
  const window = Object.assign(new EventEmitter(), {
    webContents: contents,
    isDestroyed: () => destroyed,
    destroy: vi.fn(() => {
      destroyed = true;
      window.emit('closed');
    }),
  });
  const clock = { elapsed: 0 };
  const pageLost = vi.fn();
  const flush = vi.fn(() => Promise.resolve());
  superviseWindow({
    // Only the members above are used.
    window: window as unknown as BrowserWindow,
    pageLost,
    flush,
    elapsed: () => clock.elapsed,
  });
  // The first load of the window.
  contents.emit('did-navigate');
  const lose = (reason = 'crashed'): void => {
    contents.emit('render-process-gone', {}, { reason, exitCode: 2 });
  };
  const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
  return { window, contents, clock, pageLost, flush, lose, settle };
}

beforeEach(() => {
  electron.questions.length = 0;
  electron.appListeners.clear();
  electron.quits = 0;
  written.length = 0;
});

describe('superviseWindow', () => {
  it('does not treat the first load as a lost page, but every later one', () => {
    const { contents, pageLost } = setup();
    expect(pageLost).not.toHaveBeenCalled();
    contents.emit('did-navigate');
    expect(pageLost).toHaveBeenCalledOnce();
    expect(written).toContainEqual(expect.objectContaining({ event: 'window.page-reloaded' }));
    expect(electron.questions).toHaveLength(0);
  });

  it('forgets the lost page at once, asks, and reloads on the first button', async () => {
    const { contents, pageLost, lose, settle, window } = setup();
    lose('crashed');
    // Before any answer: closing the window must not ask a dead page to save.
    expect(pageLost).toHaveBeenCalledOnce();
    expect(written).toContainEqual({
      level: 'error',
      event: 'window.renderer-gone',
      data: { reason: 'crashed', exitCode: 2, expected: false, canReload: true },
    });
    const [question] = electron.questions;
    expect(question?.options).toMatchObject({
      type: 'error',
      message: 'The Koma Motion window stopped working.',
      buttons: ['Reload window', 'Quit Koma Motion'],
      defaultId: 0,
      cancelId: 0,
    });
    question?.answer(0);
    await settle();
    expect(contents.reload).toHaveBeenCalledOnce();
    expect(window.destroy).not.toHaveBeenCalled();
  });

  it('quits on request after pending recovery writes, without closing through the page', async () => {
    const { contents, flush, lose, settle, window } = setup();
    lose();
    electron.questions[0]?.answer(1);
    await settle();
    expect(flush).toHaveBeenCalledOnce();
    expect(window.destroy).toHaveBeenCalledOnce();
    expect(contents.reload).not.toHaveBeenCalled();
    expect(written).toContainEqual(
      expect.objectContaining({ event: 'window.renderer-gone-choice', data: { choice: 'quit' } }),
    );
  });

  it('still quits when the recovery writes fail', async () => {
    const { flush, lose, settle, window } = setup();
    flush.mockRejectedValueOnce(new Error('disk'));
    lose();
    electron.questions[0]?.answer(1);
    await settle();
    expect(window.destroy).toHaveBeenCalledOnce();
  });

  it('offers only to quit at the third loss within a minute, and quits', async () => {
    const { contents, clock, lose, settle, window } = setup();
    for (const time of [0, 10_000]) {
      clock.elapsed = time;
      lose();
      electron.questions.at(-1)?.answer(0);
      await settle();
      contents.emit('did-navigate');
    }
    expect(contents.reload).toHaveBeenCalledTimes(2);
    clock.elapsed = 20_000;
    lose();
    expect(electron.questions.at(-1)?.options.buttons).toEqual(['Quit Koma Motion']);
    electron.questions.at(-1)?.answer(0);
    await settle();
    expect(contents.reload).toHaveBeenCalledTimes(2);
    expect(window.destroy).toHaveBeenCalledOnce();
  });

  it('ends the window of a lost page directly when the application quits during the question', async () => {
    const { contents, flush, lose, pageLost, settle, window } = setup();
    lose();
    for (const listener of electron.appListeners.get('before-quit') ?? []) listener();
    expect(electron.questions[0]?.options.signal?.aborted).toBe(true);
    await settle();
    await settle();
    // Not through the ordinary close, which a window with an open sheet ignores on macOS.
    expect(flush).toHaveBeenCalledOnce();
    expect(window.destroy).toHaveBeenCalledOnce();
    expect(contents.reload).not.toHaveBeenCalled();
    expect(pageLost).toHaveBeenCalledTimes(2);
    // The closed window ends the quit; nothing asks for another one.
    expect(electron.quits).toBe(0);
    expect(written).toContainEqual(
      expect.objectContaining({ event: 'window.quit-during-question', data: { about: 'gone' } }),
    );
    expect(electron.appListeners.get('before-quit')?.size).toBe(0);
  });

  it('asks to quit again once the question about a page that does not respond is gone', async () => {
    const { settle, window } = setup();
    window.emit('unresponsive');
    for (const listener of electron.appListeners.get('before-quit') ?? []) listener();
    expect(electron.quits).toBe(0);
    await settle();
    await settle();
    // That page may still answer, so it closes the ordinary way, after the question.
    expect(window.destroy).not.toHaveBeenCalled();
    expect(electron.quits).toBe(1);
    // The second request finds no question and asks for nothing more.
    for (const listener of electron.appListeners.get('before-quit') ?? []) listener();
    await settle();
    await settle();
    expect(electron.quits).toBe(1);
  });

  it('does not quit when a question is withdrawn for another reason', async () => {
    const { settle, window } = setup();
    window.emit('unresponsive');
    window.emit('responsive');
    await settle();
    await settle();
    expect(electron.quits).toBe(0);
  });

  it('does not reload or ask again after the application quit during the question', async () => {
    const { contents, lose, settle } = setup();
    lose();
    for (const listener of electron.appListeners.get('before-quit') ?? []) listener();
    await settle();
    await settle();
    expect(contents.reload).not.toHaveBeenCalled();
    expect(electron.appListeners.get('before-quit')?.size).toBe(0);
    // A renderer that ends with its window is not a failure.
    lose('killed');
    expect(electron.questions).toHaveLength(1);
    expect(written.at(-1)).toMatchObject({ level: 'info', data: { expected: true } });
  });

  it('asks about a page that does not respond and keeps waiting by default', async () => {
    const { contents, pageLost, settle, window } = setup();
    window.emit('unresponsive');
    // A second signal does not stack a second question.
    window.emit('unresponsive');
    expect(electron.questions).toHaveLength(1);
    expect(electron.questions[0]?.options).toMatchObject({
      type: 'warning',
      message: 'The Koma Motion window is not responding.',
      buttons: ['Keep waiting', 'Reload window', 'Quit Koma Motion'],
      cancelId: 0,
    });
    electron.questions[0]?.answer(0);
    await settle();
    expect(pageLost).not.toHaveBeenCalled();
    expect(contents.forcefullyCrashRenderer).not.toHaveBeenCalled();
  });

  it('withdraws that question when the page responds again', async () => {
    const { contents, settle, window } = setup();
    window.emit('unresponsive');
    window.emit('responsive');
    await settle();
    expect(electron.questions[0]?.options.signal?.aborted).toBe(true);
    expect(contents.reload).not.toHaveBeenCalled();
    expect(window.destroy).not.toHaveBeenCalled();
  });

  it('ends an unresponsive renderer to reload it, and does not ask about that loss', async () => {
    const { contents, pageLost, lose, settle, window } = setup();
    window.emit('unresponsive');
    electron.questions[0]?.answer(1);
    await settle();
    expect(pageLost).toHaveBeenCalledOnce();
    expect(contents.forcefullyCrashRenderer).toHaveBeenCalledOnce();
    expect(contents.reload).toHaveBeenCalledOnce();
    lose('crashed');
    expect(electron.questions).toHaveLength(1);
    expect(written.at(-1)).toMatchObject({
      level: 'info',
      event: 'window.renderer-gone',
      data: { expected: true },
    });
    // The next loss is unexpected again.
    contents.emit('did-navigate');
    lose('crashed');
    expect(electron.questions).toHaveLength(2);
  });

  it('quits from an unresponsive page without asking it to save', async () => {
    const { pageLost, flush, settle, window } = setup();
    window.emit('unresponsive');
    electron.questions[0]?.answer(2);
    await settle();
    expect(pageLost).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledOnce();
    expect(window.destroy).toHaveBeenCalledOnce();
  });

  it('replaces the waiting question when the unresponsive renderer is gone', async () => {
    const { contents, lose, settle, window } = setup();
    window.emit('unresponsive');
    lose('killed');
    expect(electron.questions).toHaveLength(2);
    expect(electron.questions[0]?.options.signal?.aborted).toBe(true);
    electron.questions[1]?.answer(0);
    await settle();
    expect(contents.reload).toHaveBeenCalledOnce();
    expect(contents.forcefullyCrashRenderer).not.toHaveBeenCalled();
  });
});
