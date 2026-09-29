import { basename, extname } from 'node:path';
import { createDefaultBrandKit } from '@koma-motion/brand-kit';
import { createProject, createRandomIdGenerator, type KomaProject } from '@koma-motion/core';
import { PROJECT_FILE_EXTENSION, touchProject } from '@koma-motion/project-format';
import { readProjectFile, writeProjectFile } from '@koma-motion/project-format/node';
import { dialog, type BrowserWindow } from 'electron';
import type { IpcResponse, ProjectFileInfo } from '../../shared/ipc';
import { isUnsafeCharacter } from './imageAsset';

const FILE_FILTERS = [{ name: 'Koma Motion project', extensions: [PROJECT_FILE_EXTENSION] }];

/** What the main process remembers about the project of a window. */
export interface ProjectSession {
  /**
   * Where the project is stored. Only native dialogs set this path; the
   * renderer can neither read nor change it.
   */
  filePath: string | null;
  hasUnsavedChanges: boolean;
  /**
   * Changes when the open project is replaced. A save that started earlier
   * must not publish its path onto the replacement.
   */
  sessionId: number;
  /** Highest save that has asked to publish a path for the current session. */
  saveTicket: number;
  /** Highest save that did publish a path. A later failure must not undo it. */
  publishedSaveTicket: number;
  /**
   * Session captured when the user chose Save while closing. A later confirm
   * closes the window only while this is still the open project.
   */
  saveAndCloseSessionId: number | null;
  /** Serialises writes so an older save cannot replace a newer file on disk. */
  writeTail: Promise<void>;
}

export function createProjectSession(): ProjectSession {
  return {
    filePath: null,
    hasUnsavedChanges: false,
    sessionId: 0,
    saveTicket: 0,
    publishedSaveTicket: 0,
    saveAndCloseSessionId: null,
    writeTail: Promise.resolve(),
  };
}

/** The window may close after Save only for the same project, and only when it is clean. */
export function canCompleteSaveAndClose(session: ProjectSession): boolean {
  return (
    session.saveAndCloseSessionId !== null &&
    session.saveAndCloseSessionId === session.sessionId &&
    !session.hasUnsavedChanges
  );
}

function replaceOpenProject(session: ProjectSession): void {
  session.sessionId += 1;
  session.filePath = null;
  session.hasUnsavedChanges = false;
  session.saveAndCloseSessionId = null;
  session.saveTicket = 0;
  session.publishedSaveTicket = 0;
}

function toFileInfo(filePath: string): ProjectFileInfo {
  return { fileName: basename(filePath), displayPath: filePath };
}

/** A file name without characters that file systems reject. */
export function toSafeFileName(name: string): string {
  const cleaned = [...name]
    .map((character) => (isUnsafeCharacter(character) ? ' ' : character))
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 80);
  return cleaned === '' ? 'Untitled' : cleaned;
}

export function withProjectExtension(filePath: string): string {
  return extname(filePath).toLowerCase() === `.${PROJECT_FILE_EXTENSION}`
    ? filePath
    : `${filePath}.${PROJECT_FILE_EXTENSION}`;
}

export function createNewProject(
  session: ProjectSession,
  name: string,
  now: Date,
): IpcResponse<'koma:project:create'> {
  replaceOpenProject(session);
  return {
    project: createProject({
      idGenerator: createRandomIdGenerator(),
      name,
      brandKit: createDefaultBrandKit(),
      now: now.toISOString(),
    }),
  };
}

export async function openProject(
  window: BrowserWindow,
  session: ProjectSession,
): Promise<IpcResponse<'koma:project:open'>> {
  const selection = await dialog.showOpenDialog(window, {
    title: 'Open project',
    filters: FILE_FILTERS,
    properties: ['openFile'],
  });
  const filePath = selection.filePaths[0];
  if (selection.canceled || filePath === undefined) {
    return { status: 'cancelled' };
  }
  const loaded = await readProjectFile(filePath);
  if (!loaded.ok) {
    return { status: 'failed', message: loaded.error.message };
  }
  replaceOpenProject(session);
  session.filePath = filePath;
  return {
    status: 'opened',
    project: loaded.value.project,
    file: toFileInfo(filePath),
    warnings: [...loaded.value.warnings],
  };
}

function enqueueWrite<T>(session: ProjectSession, operation: () => Promise<T>): Promise<T> {
  const run = session.writeTail.then(operation, operation);
  session.writeTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Writes `project` and publishes `filePath` when this save belongs to the
 * session that started it and no newer save of that session has already
 * published a path. A failed later save leaves the earlier path in place.
 * Writes are queued so an older save cannot finish after a newer one and put
 * the old bytes back on disk.
 */
async function writeTo(
  filePath: string,
  project: KomaProject,
  session: ProjectSession,
  now: Date,
  sessionId: number,
): Promise<IpcResponse<'koma:project:save'>> {
  const ticket = ++session.saveTicket;
  const saved = await enqueueWrite(session, () =>
    writeProjectFile(filePath, touchProject(project, now.toISOString())),
  );
  if (!saved.ok) {
    return { status: 'failed', message: saved.error.message };
  }
  if (session.sessionId === sessionId && ticket > session.publishedSaveTicket) {
    session.filePath = filePath;
    session.publishedSaveTicket = ticket;
  }
  return { status: 'saved', project: saved.value, file: toFileInfo(filePath) };
}

export async function saveProjectAs(
  window: BrowserWindow,
  session: ProjectSession,
  project: KomaProject,
  now: Date,
  sessionId = session.sessionId,
): Promise<IpcResponse<'koma:project:save-as'>> {
  const selection = await dialog.showSaveDialog(window, {
    title: 'Save project as',
    defaultPath: session.filePath ?? `${toSafeFileName(project.name)}.${PROJECT_FILE_EXTENSION}`,
    filters: FILE_FILTERS,
    properties: ['showOverwriteConfirmation', 'createDirectory'],
  });
  if (selection.canceled || selection.filePath === '') {
    return { status: 'cancelled' };
  }
  // The dialog outlived the project it was opened for.
  if (session.sessionId !== sessionId) {
    return { status: 'cancelled' };
  }
  return writeTo(withProjectExtension(selection.filePath), project, session, now, sessionId);
}

export async function saveProject(
  window: BrowserWindow,
  session: ProjectSession,
  project: KomaProject,
  now: Date,
): Promise<IpcResponse<'koma:project:save'>> {
  const sessionId = session.sessionId;
  if (session.filePath === null) {
    return saveProjectAs(window, session, project, now, sessionId);
  }
  return writeTo(session.filePath, project, session, now, sessionId);
}
