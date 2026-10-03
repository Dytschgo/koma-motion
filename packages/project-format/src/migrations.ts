import { CURRENT_SCHEMA_VERSION, err, ok, type Result } from '@koma-motion/core';
import { projectFormatError, type ProjectFormatError } from './errors';

export type RawProject = Readonly<Record<string, unknown>>;

/** Upgrades a raw project document by exactly one schema version. */
export interface Migration {
  readonly fromVersion: number;
  readonly migrate: (document: RawProject) => RawProject;
}

/**
 * Migrations in ascending order. When the schema changes:
 *
 * 1. increase `CURRENT_SCHEMA_VERSION` in @koma-motion/core,
 * 2. add a migration from the previous version here,
 * 3. add a test with a project file of the previous version.
 */
export const MIGRATIONS: readonly Migration[] = [
  // Version 1 had no active instructions. Do not activate unknown extension data.
  { fromVersion: 1, migrate: (document) => ({ ...document, systemInstructions: '' }) },
  {
    fromVersion: 2,
    migrate: (document) => {
      const configuration = document['agentConfiguration'];
      if (
        typeof configuration !== 'object' ||
        configuration === null ||
        Array.isArray(configuration)
      )
        return document;
      if (!('timeoutSeconds' in configuration) || typeof configuration.timeoutSeconds !== 'number')
        return document;
      return { ...document, agentConfiguration: { ...configuration, timeoutSeconds: null } };
    },
  },
  {
    fromVersion: 3,
    migrate: (document) => {
      const config = document['agentConfiguration'];
      if (typeof config !== 'object' || config === null || !('providers' in config))
        return document;
      const providers = config.providers;
      if (typeof providers !== 'object' || providers === null || Array.isArray(providers))
        return document;
      // Older unknown fields must not become active execution preferences.
      return {
        ...document,
        agentConfiguration: {
          ...config,
          providers: Object.fromEntries(
            Object.entries(providers).map(([id, value]: [string, unknown]) => {
              if (typeof value !== 'object' || value === null) return [id, value];
              return [
                id,
                Object.fromEntries(
                  Object.entries(value).filter(([key]) => key !== 'reasoningByModel'),
                ),
              ];
            }),
          ),
        },
      };
    },
  },
  {
    fromVersion: 4,
    migrate: (document) => {
      const presentation = document['presentation'];
      if (
        typeof presentation !== 'object' ||
        presentation === null ||
        !('komas' in presentation) ||
        !Array.isArray(presentation.komas)
      )
        return document;
      return {
        ...document,
        presentation: {
          ...presentation,
          // Older unknown fields must not become active playback timing.
          komas: presentation.komas.map((koma: unknown) =>
            typeof koma === 'object' && koma !== null && !Array.isArray(koma)
              ? { ...koma, holdDurationMs: null }
              : koma,
          ),
        },
      };
    },
  },
];

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
    try {
      current = { ...migration.migrate(current), schemaVersion: version + 1 };
    } catch {
      return err(
        projectFormatError(
          'migrationFailed',
          `The upgrade from format version ${String(version)} to ${String(version + 1)} could not be completed.`,
        ),
      );
    }
  }
  return ok({ document: current, migratedFrom: fromVersion });
}
