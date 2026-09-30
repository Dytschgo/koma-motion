import {
  collectProjectWarnings,
  describeIssues,
  err,
  exceedsUtf8ByteLength,
  komaProjectSchema,
  MAX_PROJECT_FILE_BYTES,
  ok,
  PROJECT_FORMAT,
  PROJECT_TOO_LARGE_MESSAGE,
  toValidationIssues,
  type KomaProject,
  type Result,
} from '@koma-motion/core';
import { validateTransition } from '@koma-motion/motion-engine';
import { isProjectTooLarge, projectFormatError, type ProjectFormatError } from './errors';
import { migrateToVersion, type RawProject } from './migrations';
import { findDroppedFields } from './unknownFields';

export interface LoadedProject {
  readonly project: KomaProject;
  /** Sentences that can be shown to the user as they are. */
  readonly warnings: readonly string[];
  /** The format version the file had, or `null` when it was already current. */
  readonly migratedFrom: number | null;
}

function isRawProject(value: unknown): value is RawProject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the format marker and version of a document without validating the
 * rest. Returns `null` when the document is not a Koma Motion project.
 */
export function readSchemaVersion(document: unknown): number | null {
  if (!isRawProject(document) || document['format'] !== PROJECT_FORMAT) {
    return null;
  }
  const version = document['schemaVersion'];
  return typeof version === 'number' && Number.isInteger(version) && version >= 1 ? version : null;
}

/** Parses, migrates and validates the text of a `.koma` file. */
export function parseProject(text: string): Result<LoadedProject, ProjectFormatError> {
  if (exceedsUtf8ByteLength(text, MAX_PROJECT_FILE_BYTES)) {
    return err(projectFormatError('tooLarge', PROJECT_TOO_LARGE_MESSAGE));
  }

  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return err(
      projectFormatError(
        'invalidJson',
        'The file is not a readable Koma Motion project. It may be damaged or incomplete.',
      ),
    );
  }

  const version = readSchemaVersion(document);
  if (!isRawProject(document) || version === null) {
    return err(
      projectFormatError(
        'notAProject',
        'The file is not a Koma Motion project: the format marker or the format version is missing.',
      ),
    );
  }

  const migrated = migrateToVersion(document, version);
  if (!migrated.ok) {
    return migrated;
  }

  const validated = komaProjectSchema.safeParse(migrated.value.document);
  if (!validated.success) {
    const issues = toValidationIssues(validated.error);
    if (isProjectTooLarge(issues)) {
      return err(projectFormatError('tooLarge', PROJECT_TOO_LARGE_MESSAGE, issues));
    }
    return err(
      projectFormatError(
        'invalidProject',
        `The project contains invalid data:\n${describeIssues(issues)}`,
        issues,
      ),
    );
  }

  const warnings: string[] = [];
  if (migrated.value.migratedFrom !== null) {
    warnings.push(
      `The project was upgraded from format version ${String(migrated.value.migratedFrom)}. Saving stores it in the current format.`,
      'Generation now runs until completion or cancellation. The old automatic time limit was disabled; you can enable an optional timer in Settings.',
    );
  }
  for (const path of findDroppedFields(migrated.value.document, validated.data)) {
    warnings.push(
      `The property "${path}" is not known to this version of Koma Motion. It was ignored and is not kept when you save.`,
    );
  }
  for (const warning of collectProjectWarnings(validated.data)) {
    warnings.push(warning.message);
  }
  for (const transition of validated.data.presentation.transitions) {
    for (const issue of validateTransition(transition, validated.data.presentation)) {
      warnings.push(issue.message);
    }
  }

  return ok({
    project: validated.data,
    warnings,
    migratedFrom: migrated.value.migratedFrom,
  });
}
