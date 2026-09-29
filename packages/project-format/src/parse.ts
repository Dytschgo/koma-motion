import {
  collectProjectWarnings,
  describeIssues,
  err,
  komaProjectSchema,
  ok,
  PROJECT_FORMAT,
  toValidationIssues,
  type KomaProject,
  type Result,
} from '@koma-motion/core';
import { projectFormatError, type ProjectFormatError } from './errors';
import { migrateToVersion, type RawProject } from './migrations';
import { findDroppedFields } from './unknownFields';

/** Largest project text that is parsed, in characters. */
export const MAX_PROJECT_TEXT_LENGTH = 64 * 1024 * 1024;

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
  if (text.length > MAX_PROJECT_TEXT_LENGTH) {
    return err(
      projectFormatError('tooLarge', 'The file is too large to be a Koma Motion project.'),
    );
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

  return ok({
    project: validated.data,
    warnings,
    migratedFrom: migrated.value.migratedFrom,
  });
}
