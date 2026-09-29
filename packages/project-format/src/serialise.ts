import {
  describeIssues,
  err,
  komaProjectSchema,
  ok,
  toValidationIssues,
  type KomaProject,
  type Result,
} from '@koma-motion/core';
import { projectFormatError, type ProjectFormatError } from './errors';

export const PROJECT_FILE_EXTENSION = 'koma';

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, sortKeysDeep(child)]),
    );
  }
  return value;
}

/**
 * Puts a validated project into its canonical shape:
 *
 * - known properties appear in schema order, `format` and `schemaVersion` first,
 * - keys of maps (provider settings, asset metadata) are sorted,
 * - unknown top-level properties follow, sorted by name.
 */
function canonicalise(project: KomaProject): Record<string, unknown> {
  const known = new Set(Object.keys(komaProjectSchema.shape));
  const canonical: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(project)) {
    if (known.has(key)) {
      canonical[key] = value;
    }
  }
  canonical['assets'] = project.assets.map((asset) => ({
    ...asset,
    metadata: sortKeysDeep(asset.metadata),
  }));
  canonical['agentConfiguration'] = {
    ...project.agentConfiguration,
    providers: sortKeysDeep(project.agentConfiguration.providers),
  };
  const unknownKeys = Object.keys(project)
    .filter((key) => !known.has(key))
    .sort();
  for (const key of unknownKeys) {
    canonical[key] = sortKeysDeep(project[key]);
  }
  return canonical;
}

/**
 * Serialises a project to the text of a `.koma` file. The same project always
 * produces the same text, whatever the property order of the input was.
 * Invalid projects are rejected and never written.
 */
export function serialiseProject(project: KomaProject): Result<string, ProjectFormatError> {
  const validated = komaProjectSchema.safeParse(project);
  if (!validated.success) {
    const issues = toValidationIssues(validated.error);
    return err(
      projectFormatError(
        'invalidProject',
        `The project cannot be saved because it is not valid:\n${describeIssues(issues)}`,
        issues,
      ),
    );
  }
  return ok(`${JSON.stringify(canonicalise(validated.data), null, 2)}\n`);
}

/** Returns a copy of the project with `updatedAt` set to `now` (ISO 8601). */
export function touchProject(project: KomaProject, now: string): KomaProject {
  return { ...project, updatedAt: now };
}
