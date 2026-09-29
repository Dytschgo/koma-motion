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
}

export function createProjectSession(): ProjectSession {
  return { filePath: null, hasUnsavedChanges: false };
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
  session.filePath = null;
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
  session.filePath = filePath;
  return {
    status: 'opened',
    project: loaded.value.project,
    file: toFileInfo(filePath),
    warnings: [...loaded.value.warnings],
  };
}

async function writeTo(
  filePath: string,
  project: KomaProject,
  session: ProjectSession,
  now: Date,
): Promise<IpcResponse<'koma:project:save'>> {
  const saved = await writeProjectFile(filePath, touchProject(project, now.toISOString()));
  if (!saved.ok) {
    return { status: 'failed', message: saved.error.message };
  }
  session.filePath = filePath;
  return { status: 'saved', project: saved.value, file: toFileInfo(filePath) };
}

export async function saveProjectAs(
  window: BrowserWindow,
  session: ProjectSession,
  project: KomaProject,
  now: Date,
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
  return writeTo(withProjectExtension(selection.filePath), project, session, now);
}

export async function saveProject(
  window: BrowserWindow,
  session: ProjectSession,
  project: KomaProject,
  now: Date,
): Promise<IpcResponse<'koma:project:save'>> {
  if (session.filePath === null) {
    return saveProjectAs(window, session, project, now);
  }
  return writeTo(session.filePath, project, session, now);
}
