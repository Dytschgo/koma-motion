import { basename, extname, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { createDefaultBrandKit } from '@koma-motion/brand-kit';
import { createProject, createRandomIdGenerator, type KomaProject } from '@koma-motion/core';
import { PROJECT_FILE_EXTENSION, touchProject } from '@koma-motion/project-format';
import { readProjectFile, writeProjectFile } from '@koma-motion/project-format/node';
import { dialog, type BrowserWindow } from 'electron';
import type { IpcResponse, ProjectFileInfo } from '../../shared/ipc';
import { isUnsafeCharacter } from './imageAsset';
import { unavailableImageAssetIds } from './imageValidation';

import type { RecoveryService } from './recovery';

const FILE_FILTERS = [{ name: 'Koma Motion project', extensions: [PROJECT_FILE_EXTENSION] }];

/** What the main process remembers about the project of a window. */
export interface ProjectSession {
  /**
   * Where the project is stored. Only native dialogs set this path; the
   * renderer can neither read nor change it.
   */
  filePath: string | null;
  /** Main-owned crash recovery and original-copy protection. */
  recovery: RecoveryService | null;
  recoveredSourcePath: string | null;
  /** Shared by queued saves, including paths first chosen by a pending Save as. */
  fileRevisions: Map<string, string>;
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
    recovery: null,
    recoveredSourcePath: null,
    fileRevisions: new Map(),
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

export function replaceOpenProject(session: ProjectSession): void {
  session.sessionId += 1;
  session.filePath = null;
  session.recoveredSourcePath = null;
  session.fileRevisions = new Map();
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
    const reason =
      loaded.error.code === 'migrationFailed'
        ? 'Its format upgrade failed.'
        : loaded.error.code === 'invalidProject'
          ? 'Some project data could not be validated.'
          : loaded.error.message;
    return {
      status: 'failed',
      message: `This project could not be opened. ${reason} The original file was not changed. Try opening it again, restore a backup, or inspect the diagnostics.`,
      diagnostics: `${loaded.error.code}: ${loaded.error.message}`,
    };
  }
  replaceOpenProject(session);
  session.filePath = filePath;
  session.fileRevisions.set(filePath, loaded.value.fileRevision);
  return {
    status: 'opened',
    project: loaded.value.project,
    file: toFileInfo(filePath),
    warnings: [...loaded.value.warnings],
    unavailableAssetIds: unavailableImageAssetIds(loaded.value.project.assets),
    migratedFrom: loaded.value.migratedFrom,
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
  // Capture this project's map, then resolve the revision when the queued write
  // runs. An earlier Save as may establish it while this request is waiting.
  const revisions = session.fileRevisions;
  const saved = await enqueueWrite(session, async () => {
    const revision = revisions.get(filePath);
    const result = await writeProjectFile(filePath, touchProject(project, now.toISOString()), {
      ...(revision === undefined ? {} : { expectedRevision: revision }),
    });
    if (result.ok) {
      revisions.set(filePath, result.value.fileRevision);
    }
    return result;
  });
  if (!saved.ok) {
    return { status: 'failed', message: saved.error.message };
  }
  if (session.sessionId === sessionId && ticket > session.publishedSaveTicket) {
    session.filePath = filePath;
    session.publishedSaveTicket = ticket;
    session.recovery?.saved(
      session.recovery.sessionId,
      saved.value.project,
      session.recoveredSourcePath ?? filePath,
    );
  }
  return { status: 'saved', project: saved.value.project, file: toFileInfo(filePath) };
}

export async function saveProjectAs(
  window: BrowserWindow,
  session: ProjectSession,
  project: KomaProject,
  now: Date,
  sessionId = session.sessionId,
  preserveOriginal = false,
): Promise<IpcResponse<'koma:project:save-as'>> {
  preserveOriginal ||= session.recoveredSourcePath !== null;
  const sourcePath = session.recoveredSourcePath ?? session.filePath;
  const selection = await dialog.showSaveDialog(window, {
    title: preserveOriginal ? 'Save a project copy' : 'Save project as',
    defaultPath: preserveOriginal
      ? `${toSafeFileName(project.name)} copy.${PROJECT_FILE_EXTENSION}`
      : (session.filePath ?? `${toSafeFileName(project.name)}.${PROJECT_FILE_EXTENSION}`),
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
  const chosenPath = withProjectExtension(selection.filePath);
  const normalise = (path: string): string =>
    process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
  let sameSource = sourcePath !== null && normalise(chosenPath) === normalise(sourcePath);
  if (preserveOriginal && sourcePath !== null && !sameSource) {
    // Native selection can name the source through a symlink, hard link or case alias.
    const [source, chosen] = await Promise.all([
      stat(sourcePath).catch(() => null),
      stat(chosenPath).catch(() => null),
    ]);
    sameSource =
      source !== null && chosen !== null && source.dev === chosen.dev && source.ino === chosen.ino;
  }
  if (preserveOriginal && sameSource) {
    return {
      status: 'failed',
      message: 'Choose a different name for the copy. The original project was not overwritten.',
    };
  }
  if (session.sessionId !== sessionId) return { status: 'cancelled' };
  return writeTo(chosenPath, project, session, now, sessionId);
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
