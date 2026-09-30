import { createHash, randomBytes } from 'node:crypto';
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

/** Fingerprint of the bytes read or written, kept only in the main process. */
function fileRevision(contents: string | Uint8Array): string {
  return createHash('sha256').update(contents).digest('hex');
}

export interface LoadedProjectFile extends LoadedProject {
  readonly fileRevision: string;
}

export interface SavedProjectFile {
  readonly project: KomaProject;
  readonly fileRevision: string;
}

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
): Promise<Result<LoadedProjectFile, ProjectFormatError>> {
  return withProjectFileOperation(async () => {
    let contents: Buffer;
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
      contents = await readFile(filePath);
    } catch (error) {
      return err(
        projectFormatError(
          'fileNotReadable',
          `"${basename(filePath)}" could not be read. ${describeFileSystemError(error)}`,
        ),
      );
    }
    const parsed = parseProject(contents.toString('utf8'));
    return parsed.ok ? ok({ ...parsed.value, fileRevision: fileRevision(contents) }) : parsed;
  });
}

type TargetInspection =
  | { readonly status: 'absent' }
  | { readonly status: 'inspected'; readonly version: number | null; readonly revision: string }
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

  let contents: Buffer;
  try {
    contents = await readFile(filePath);
  } catch (error) {
    return {
      status: 'uninspectable',
      message: uninspectableMessage(filePath, describeFileSystemError(error)),
    };
  }

  try {
    const document: unknown = JSON.parse(contents.toString('utf8'));
    return {
      status: 'inspected',
      version: readSchemaVersion(document),
      revision: fileRevision(contents),
    };
  } catch {
    return { status: 'inspected', version: null, revision: fileRevision(contents) };
  }
}

async function checkTarget(
  filePath: string,
  expectedRevision: string | undefined,
): Promise<ProjectFormatError | null> {
  const inspection = await inspectExistingTarget(filePath);
  if (inspection.status === 'uninspectable') {
    return projectFormatError('uninspectableTarget', inspection.message);
  }
  if (
    inspection.status === 'inspected' &&
    inspection.version !== null &&
    inspection.version > CURRENT_SCHEMA_VERSION
  ) {
    return projectFormatError(
      'wouldOverwriteNewerProject',
      `"${basename(filePath)}" was saved by a newer version of Koma Motion (format version ${String(inspection.version)}). It was not overwritten. Save under a different name instead.`,
    );
  }
  if (
    expectedRevision !== undefined &&
    (inspection.status !== 'inspected' || inspection.revision !== expectedRevision)
  ) {
    return projectFormatError(
      'fileChangedExternally',
      `"${basename(filePath)}" was changed or removed outside this window. It was not overwritten. Your edits are still open. Use Save as to save them under a different name, or reopen the file to see its latest contents.`,
    );
  }
  return null;
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
export async function writeFileAtomic(
  filePath: string,
  text: string,
  beforeReplace?: () => Promise<void>,
): Promise<void> {
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
    await beforeReplace?.();
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
 * cannot be inspected is not overwritten either. When `expectedRevision` is
 * supplied, a file changed or removed since it was read is also kept.
 * This is optimistic conflict detection, not a cross-process filesystem lock:
 * another writer can still race the final check and rename.
 */
export async function writeProjectFile(
  filePath: string,
  project: KomaProject,
  options: { readonly expectedRevision?: string } = {},
): Promise<Result<SavedProjectFile, ProjectFormatError>> {
  return withProjectFileOperation(async () => {
    const rejection = await checkTarget(filePath, options.expectedRevision);
    if (rejection !== null) {
      return err(rejection);
    }

    const serialised = serialiseProject(project);
    if (!serialised.ok) {
      return serialised;
    }

    let finalRejection: ProjectFormatError | null = null;
    try {
      await writeFileAtomic(filePath, serialised.value, async () => {
        finalRejection = await checkTarget(filePath, options.expectedRevision);
        if (finalRejection !== null) {
          throw new Error('Project replacement rejected');
        }
      });
    } catch (error) {
      if (finalRejection !== null) {
        return err(finalRejection);
      }
      return err(
        projectFormatError(
          'fileNotWritable',
          `"${basename(filePath)}" could not be saved. ${describeFileSystemError(error)} Your previous file was not changed.`,
        ),
      );
    }
    return ok({ project, fileRevision: fileRevision(serialised.value) });
  });
}
