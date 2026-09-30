import { join, sep } from 'node:path';
import type { KomaProject } from '@koma-motion/core';
import { err, ok } from '@koma-motion/core';
import { buildProject } from '@koma-motion/core/testing';
import { readProjectFile, writeProjectFile } from '@koma-motion/project-format/node';
import type { BrowserWindow } from 'electron';
import { dialog } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canCompleteSaveAndClose,
  createNewProject,
  createProjectSession,
  openProject,
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

const showOpenDialog = vi.spyOn(dialog, 'showOpenDialog');
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
          resolve(ok({ project, fileRevision: `saved-${project.name}` }));
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

  it('keeps the editor session and file revision intact after a failed migration', async () => {
    session.filePath = 'original.koma';
    session.fileRevisions.set('original.koma', 'original-revision');
    session.hasUnsavedChanges = true;
    const before = { ...session };
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['broken.koma'],
    });
    vi.mocked(readProjectFile).mockResolvedValue(
      err({
        code: 'migrationFailed',
        message: 'The upgrade could not be validated: name is invalid.',
        issues: [],
      }),
    );
    const result = await openProject(window, session);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.message).toContain('original file was not changed');
      expect(result.diagnostics).toContain('migrationFailed');
    }
    expect(session).toEqual(before);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('refuses Save a Copy to the source file before any write', async () => {
    const path = join(sep, 'projects', 'source.koma');
    session.filePath = path;
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: path });
    const result = await saveProjectAs(
      window,
      session,
      buildProject(),
      now,
      session.sessionId,
      true,
    );
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.message).toContain('different name');
    expect(writeFile).not.toHaveBeenCalled();
    expect(session.filePath).toBe(path);
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

  it('uses the latest local revision for queued saves of the same file', async () => {
    const filePath = join(sep, 'projects', 'shared.koma');
    session.filePath = filePath;
    session.fileRevisions.set(filePath, 'opened-revision');
    const held = holdWrites();
    const first = saveProject(window, session, buildProject({ name: 'First' }), now);
    const second = saveProject(window, session, buildProject({ name: 'Second' }), now);
    await flush();
    expect(writeFile.mock.calls[0]?.[2]).toEqual({ expectedRevision: 'opened-revision' });
    held[0]?.release();
    await first;
    await flush();
    expect(writeFile.mock.calls[1]?.[2]).toEqual({ expectedRevision: 'saved-First' });
    held[1]?.release();
    await second;
    expect(session.fileRevisions.get(filePath)).toBe('saved-Second');
  });

  it('preserves the file baseline when a save fails', async () => {
    const filePath = join(sep, 'projects', 'shared.koma');
    session.filePath = filePath;
    session.fileRevisions.set(filePath, 'opened-revision');
    const held = holdWrites();
    const pending = saveProject(window, session, buildProject(), now);
    await flush();
    held[0]?.fail();
    await pending;
    expect(session.fileRevisions.get(filePath)).toBe('opened-revision');
  });

  it('checks the revision established by an overlapping Save as to the same new path', async () => {
    const filePath = join(sep, 'projects', 'new.koma');
    showSaveDialog.mockResolvedValue({ canceled: false, filePath });
    const held = holdWrites();
    const first = saveProjectAs(window, session, buildProject({ name: 'First' }), now);
    const second = saveProjectAs(window, session, buildProject({ name: 'Second' }), now);
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(writeFile.mock.calls[0]?.[2]).toEqual({});
    held[0]?.release();
    await vi.waitFor(() => expect(held).toHaveLength(2));
    expect(writeFile.mock.calls[1]?.[2]).toEqual({ expectedRevision: 'saved-First' });
    held[1]?.fail();
    await first;
    await expect(second).resolves.toMatchObject({ status: 'failed' });
    expect(session.fileRevisions.get(filePath)).toBe('saved-First');
    expect(session.filePath).toBe(filePath);
  });

  it('keeps old queued revisions separate from a replacement project', async () => {
    const filePath = join(sep, 'projects', 'shared.koma');
    session.filePath = filePath;
    session.fileRevisions.set(filePath, 'opened-revision');
    const held = holdWrites();
    const first = saveProject(window, session, buildProject({ name: 'First' }), now);
    const second = saveProject(window, session, buildProject({ name: 'Second' }), now);
    await vi.waitFor(() => expect(held).toHaveLength(1));
    createNewProject(session, 'Replacement', now);
    held[0]?.release();
    await vi.waitFor(() => expect(held).toHaveLength(2));
    expect(writeFile.mock.calls[1]?.[2]).toEqual({ expectedRevision: 'saved-First' });
    held[1]?.release();
    await Promise.all([first, second]);
    expect(session.filePath).toBeNull();
    expect(session.fileRevisions.size).toBe(0);
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

  it('serialises writes and keeps the path of the newest successful save', async () => {
    session.filePath = 'C:\\current.koma';
    const held = holdWrites();
    const first = saveProject(window, session, buildProject({ name: 'Current' }), now);
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\\other.koma' });
    const second = saveProjectAs(window, session, buildProject({ name: 'Other' }), now);
    await flush();

    expect(held).toHaveLength(1);
    held[0]?.release();
    await first;
    await vi.waitFor(() => expect(held).toHaveLength(2));
    held[1]?.release();
    await second;

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
    await first;
    await vi.waitFor(() => expect(held).toHaveLength(2));
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
