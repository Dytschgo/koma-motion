import { randomBytes } from 'node:crypto';
import { open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  CURRENT_SCHEMA_VERSION,
  err,
  MAX_PROJECT_FILE_BYTES,
  ok,
  PROJECT_TOO_LARGE_MESSAGE,
  type KomaProject,
  type Result,
} from '@koma-motion/core';
import { projectFormatError, type ProjectFormatError } from '../errors';
import { parseProject, readSchemaVersion, type LoadedProject } from '../parse';
import { serialiseProject } from '../serialise';
import { withProjectFileOperation } from './operationGate';

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

function uninspectableMessage(filePath: string, detail: string): string {
  return `"${basename(filePath)}" could not be inspected, so it was not overwritten. ${detail} Save under a different name instead.`;
}

export async function readProjectFile(
  filePath: string,
): Promise<Result<LoadedProject, ProjectFormatError>> {
  return withProjectFileOperation(async () => {
    let text: string;
    try {
      const details = await stat(filePath);
      if (!details.isFile()) {
        return err(
          projectFormatError(
            'fileNotReadable',
            `"${basename(filePath)}" could not be read. The selected location is a folder, not a file.`,
          ),
        );
      }
      if (details.size > MAX_PROJECT_FILE_BYTES) {
        return err(projectFormatError('tooLarge', PROJECT_TOO_LARGE_MESSAGE));
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
  });
}

type TargetInspection =
  | { readonly status: 'absent' }
  | { readonly status: 'inspected'; readonly version: number | null }
  | { readonly status: 'uninspectable'; readonly message: string };

/**
 * Distinguishes a path that can be created from a path that already exists
 * but cannot be read safely. An existing unreadable file is not treated as
 * absent: it may be a project written by a newer version.
 */
async function inspectExistingTarget(filePath: string): Promise<TargetInspection> {
  let details: Awaited<ReturnType<typeof stat>>;
  try {
    details = await stat(filePath);
  } catch (error) {
    if (isFileSystemError(error) && error.code === 'ENOENT') {
      return { status: 'absent' };
    }
    return {
      status: 'uninspectable',
      message: uninspectableMessage(filePath, describeFileSystemError(error)),
    };
  }

  if (!details.isFile()) {
    return {
      status: 'uninspectable',
      message: uninspectableMessage(filePath, 'The selected location is a folder, not a file.'),
    };
  }

  if (details.size > MAX_PROJECT_FILE_BYTES) {
    return {
      status: 'uninspectable',
      message: uninspectableMessage(filePath, 'The file is too large to inspect.'),
    };
  }

  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    return {
      status: 'uninspectable',
      message: uninspectableMessage(filePath, describeFileSystemError(error)),
    };
  }

  try {
    const document: unknown = JSON.parse(text);
    return { status: 'inspected', version: readSchemaVersion(document) };
  } catch {
    return { status: 'inspected', version: null };
  }
}

/**
 * Replaces `filePath` so readers see either the previous contents or the
 * complete new contents. The text is written to a temporary file in the same
 * folder, flushed, and renamed over the target.
 *
 * The rename is atomic replacement of the directory entry where the file
 * system provides it. Flushing the temporary file does not flush that
 * directory, so this is not a guarantee against power loss. A failure before
 * the rename leaves the target unchanged and removes the temporary file.
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
 * newer version of Koma Motion is never overwritten. An existing file that
 * cannot be inspected is not overwritten either.
 */
export async function writeProjectFile(
  filePath: string,
  project: KomaProject,
): Promise<Result<KomaProject, ProjectFormatError>> {
  return withProjectFileOperation(async () => {
    const inspection = await inspectExistingTarget(filePath);
    if (inspection.status === 'uninspectable') {
      return err(projectFormatError('uninspectableTarget', inspection.message));
    }
    if (
      inspection.status === 'inspected' &&
      inspection.version !== null &&
      inspection.version > CURRENT_SCHEMA_VERSION
    ) {
      return err(
        projectFormatError(
          'wouldOverwriteNewerProject',
          `"${basename(filePath)}" was saved by a newer version of Koma Motion (format version ${String(inspection.version)}). It was not overwritten. Save under a different name instead.`,
        ),
      );
    }

    const serialised = serialiseProject(project);
    if (!serialised.ok) {
      return serialised;
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
  });
}
