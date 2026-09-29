import { join, sep } from 'node:path';
import type { KomaProject } from '@koma-motion/core';
import { err, ok } from '@koma-motion/core';
import { buildProject } from '@koma-motion/core/testing';
import { writeProjectFile } from '@koma-motion/project-format/node';
import type { BrowserWindow } from 'electron';
import { dialog } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canCompleteSaveAndClose,
  createNewProject,
  createProjectSession,
  saveProject,
  saveProjectAs,
  type ProjectSession,
} from './projectFiles';

vi.mock('electron', () => ({
  dialog: {
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
  },
}));

vi.mock('@koma-motion/project-format/node', () => ({
  readProjectFile: vi.fn(),
  writeProjectFile: vi.fn(),
}));

const showSaveDialog = vi.spyOn(dialog, 'showSaveDialog');
const writeFile = vi.mocked(writeProjectFile);
const window = {} as BrowserWindow;
const now = new Date('2026-09-29T12:00:00.000Z');

interface HeldWrite {
  readonly filePath: string;
  release: () => void;
  fail: () => void;
}

function holdWrites(): HeldWrite[] {
  const held: HeldWrite[] = [];
  writeFile.mockImplementation((filePath: string, project: KomaProject) => {
    return new Promise((resolve) => {
      held.push({
        filePath,
        release: () => {
          resolve(ok(project));
        },
        fail: () => {
          resolve(
            err({
              code: 'fileNotWritable',
              message: 'The project could not be saved.',
              issues: [],
            }),
          );
        },
      });
    });
  });
  return held;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('project file session', () => {
  let session: ProjectSession;

  beforeEach(() => {
    session = createProjectSession();
    session.sessionId = 1;
    showSaveDialog.mockReset();
    writeFile.mockReset();
  });

  it('does not point the replacement project at a save that was already running', async () => {
    session.filePath = 'C:\\project-a.koma';
    const held = holdWrites();
    const projectA = buildProject({ name: 'Project A' });
    const pending = saveProject(window, session, projectA, now);
    await flush();
    expect(writeFile).toHaveBeenCalledTimes(1);

    createNewProject(session, 'Project B', now);
    expect(session.filePath).toBeNull();
    held[0]?.release();
    await pending;

    expect(session.filePath).toBeNull();
    expect(session.sessionId).toBe(2);
  });

  it('does not adopt a path chosen after the project was replaced', async () => {
    session.filePath = null;
    const dialogResult = defer<{ canceled: boolean; filePath: string }>();
    showSaveDialog.mockReturnValue(dialogResult.promise);
    const pending = saveProject(window, session, buildProject({ name: 'Project A' }), now);
    await flush();

    createNewProject(session, 'Project B', now);
    dialogResult.resolve({ canceled: false, filePath: 'C:\\project-a.koma' });
    await expect(pending).resolves.toEqual({ status: 'cancelled' });
    expect(session.filePath).toBeNull();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('keeps the newest save path when an earlier write finishes last', async () => {
    session.filePath = 'C:\\current.koma';
    const held = holdWrites();
    const first = saveProject(window, session, buildProject({ name: 'Current' }), now);
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\\other.koma' });
    const second = saveProjectAs(window, session, buildProject({ name: 'Other' }), now);
    await flush();

    // Finish whichever writes have already started, newest request last, and
    // repeat so a write that was waiting on an older one can run afterwards.
    for (let attempt = 0; attempt < 4 && held.length > 0; attempt += 1) {
      const started = held.splice(0, held.length);
      for (let index = started.length - 1; index >= 0; index -= 1) {
        started[index]?.release();
      }
      await flush();
    }
    await Promise.all([first, second]);

    expect(session.filePath).toBe('C:\\other.koma');
    expect(writeFile.mock.calls.map((call) => call[0])).toEqual([
      'C:\\current.koma',
      'C:\\other.koma',
    ]);
  });

  it('keeps a completed save when a later save fails', async () => {
    // Paths of this platform: the file name is derived from the path.
    const firstPath = join(sep, 'projects', 'first.koma');
    const secondPath = join(sep, 'projects', 'second.koma');
    session.filePath = null;
    const held = holdWrites();
    showSaveDialog
      .mockResolvedValueOnce({ canceled: false, filePath: firstPath })
      .mockResolvedValueOnce({ canceled: false, filePath: secondPath });
    const first = saveProject(window, session, buildProject({ name: 'First' }), now);
    const second = saveProjectAs(window, session, buildProject({ name: 'Second' }), now);
    await flush();

    held[0]?.release();
    await flush();
    held[1]?.fail();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toMatchObject({
      status: 'saved',
      file: { fileName: 'first.koma', displayPath: firstPath },
    });
    expect(secondResult).toEqual({
      status: 'failed',
      message: 'The project could not be saved.',
    });
    expect(session.filePath).toBe(firstPath);
  });

  it('leaves the path unchanged when the save dialog is cancelled', async () => {
    session.filePath = null;
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' });
    await expect(
      saveProject(window, session, buildProject({ name: 'Draft' }), now),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(session.filePath).toBeNull();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('closes after Save only for the same clean project', () => {
    session.sessionId = 3;
    session.saveAndCloseSessionId = 3;
    session.hasUnsavedChanges = false;
    expect(canCompleteSaveAndClose(session)).toBe(true);

    session.hasUnsavedChanges = true;
    expect(canCompleteSaveAndClose(session)).toBe(false);

    session.hasUnsavedChanges = false;
    session.sessionId = 4;
    expect(canCompleteSaveAndClose(session)).toBe(false);

    session.saveAndCloseSessionId = null;
    session.sessionId = 4;
    expect(canCompleteSaveAndClose(session)).toBe(false);
  });
});

function defer<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
