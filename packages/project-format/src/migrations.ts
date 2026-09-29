import { CURRENT_SCHEMA_VERSION, err, ok, type Result } from '@koma-motion/core';
import { projectFormatError, type ProjectFormatError } from './errors';

export type RawProject = Readonly<Record<string, unknown>>;

/** Upgrades a raw project document by exactly one schema version. */
export interface Migration {
  readonly fromVersion: number;
  readonly migrate: (document: RawProject) => RawProject;
}

/**
 * Migrations in ascending order. Schema version 1 is the first version, so
 * the list is empty. When the schema changes:
 *
 * 1. increase `CURRENT_SCHEMA_VERSION` in @koma-motion/core,
 * 2. add a migration from the previous version here,
 * 3. add a test with a project file of the previous version.
 */
export const MIGRATIONS: readonly Migration[] = [];

export interface MigrationOutcome {
  readonly document: RawProject;
  /** The version the document had before migration, or `null` when nothing was migrated. */
  readonly migratedFrom: number | null;
}

export function migrateToVersion(
  document: RawProject,
  fromVersion: number,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
  migrations: readonly Migration[] = MIGRATIONS,
): Result<MigrationOutcome, ProjectFormatError> {
  if (fromVersion === targetVersion) {
    return ok({ document, migratedFrom: null });
  }
  if (fromVersion > targetVersion) {
    return err(
      projectFormatError(
        'newerSchemaVersion',
        `This project uses format version ${String(fromVersion)}. This version of Koma Motion supports up to version ${String(targetVersion)}. Update Koma Motion to open the project.`,
      ),
    );
  }

  let current = document;
  for (let version = fromVersion; version < targetVersion; version += 1) {
    const migration = migrations.find((candidate) => candidate.fromVersion === version);
    if (migration === undefined) {
      return err(
        projectFormatError(
          'unsupportedSchemaVersion',
          `This project uses format version ${String(fromVersion)}, which this version of Koma Motion cannot upgrade.`,
        ),
      );
    }
    current = { ...migration.migrate(current), schemaVersion: version + 1 };
  }
  return ok({ document: current, migratedFrom: fromVersion });
}
