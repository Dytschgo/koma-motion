import { randomBytes } from 'node:crypto';
import { open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { CURRENT_SCHEMA_VERSION, err, ok, type KomaProject, type Result } from '@koma-motion/core';
import { projectFormatError, type ProjectFormatError } from '../errors';
import {
  MAX_PROJECT_TEXT_LENGTH,
  parseProject,
  readSchemaVersion,
  type LoadedProject,
} from '../parse';
import { serialiseProject } from '../serialise';

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function describeFileSystemError(error: unknown): string {
  if (isFileSystemError(error)) {
    switch (error.code) {
      case 'ENOENT':
        return 'The file does not exist.';
      case 'EACCES':
      case 'EPERM':
        return 'Koma Motion is not allowed to access this location.';
      case 'EBUSY':
        return 'The file is in use by another application.';
      case 'ENOSPC':
        return 'There is not enough space on the disk.';
      case 'EISDIR':
        return 'The selected location is a folder, not a file.';
      default:
        return `The operating system reported the error ${error.code ?? 'unknown'}.`;
    }
  }
  return 'An unexpected error occurred.';
}

export async function readProjectFile(
  filePath: string,
): Promise<Result<LoadedProject, ProjectFormatError>> {
  let text: string;
  try {
    const details = await stat(filePath);
    if (details.size > MAX_PROJECT_TEXT_LENGTH) {
      return err(
        projectFormatError('tooLarge', 'The file is too large to be a Koma Motion project.'),
      );
    }
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    return err(
      projectFormatError(
        'fileNotReadable',
        `"${basename(filePath)}" could not be read. ${describeFileSystemError(error)}`,
      ),
    );
  }
  return parseProject(text);
}

/**
 * Returns the format version of the project stored at `filePath`, or `null`
 * when there is no file or the file is not a Koma Motion project.
 */
async function readExistingSchemaVersion(filePath: string): Promise<number | null> {
  try {
    const details = await stat(filePath);
    if (details.size > MAX_PROJECT_TEXT_LENGTH) {
      return null;
    }
    const document: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    return readSchemaVersion(document);
  } catch {
    return null;
  }
}

/**
 * Writes `text` so that `filePath` holds either the previous content or the
 * complete new content, never a mixture: the text goes to a temporary file in
 * the same folder, is flushed to disk and then renamed over the target.
 */
export async function writeFileAtomic(filePath: string, text: string): Promise<void> {
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${randomBytes(6).toString('hex')}.tmp`,
  );
  let renamed = false;
  try {
    const handle = await open(temporaryPath, 'wx');
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, filePath);
    renamed = true;
  } finally {
    if (!renamed) {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}

/**
 * Validates and saves a project. An existing project that was written by a
 * newer version of Koma Motion is never overwritten.
 */
export async function writeProjectFile(
  filePath: string,
  project: KomaProject,
): Promise<Result<KomaProject, ProjectFormatError>> {
  const serialised = serialiseProject(project);
  if (!serialised.ok) {
    return serialised;
  }

  const existingVersion = await readExistingSchemaVersion(filePath);
  if (existingVersion !== null && existingVersion > CURRENT_SCHEMA_VERSION) {
    return err(
      projectFormatError(
        'wouldOverwriteNewerProject',
        `"${basename(filePath)}" was saved by a newer version of Koma Motion (format version ${String(existingVersion)}). It was not overwritten. Save under a different name instead.`,
      ),
    );
  }

  try {
    await writeFileAtomic(filePath, serialised.value);
  } catch (error) {
    return err(
      projectFormatError(
        'fileNotWritable',
        `"${basename(filePath)}" could not be saved. ${describeFileSystemError(error)} Your previous file was not changed.`,
      ),
    );
  }
  return ok(project);
}
