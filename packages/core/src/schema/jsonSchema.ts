import { z } from 'zod';
import { CURRENT_SCHEMA_VERSION, komaProjectSchema } from './project';

/** Where the generated schema is published in the repository. */
export const PROJECT_JSON_SCHEMA_PATH = 'docs/schema/koma-project.schema.json';

export const PROJECT_JSON_SCHEMA_ID =
  'https://raw.githubusercontent.com/Dytschgo/koma-motion/main/docs/schema/koma-project.schema.json';

const EXTENSION_DATA_DESCRIPTION =
  'Extension data: unknown top-level properties are kept when the project is saved. ' +
  'Values must be JSON, nested at most 32 levels, with at most 10,000 values per property, ' +
  'at most 1,000 properties per object and property names of at most 256 characters.';

/**
 * The JSON Schema (draft 2020-12) of the current `.koma` format, generated
 * from {@link komaProjectSchema}. It describes the documents this version of
 * Koma Motion opens without warnings:
 *
 * - optional properties with a default may be omitted, as when a file is read,
 * - unknown top-level properties are allowed (extension data),
 * - unknown nested properties are not allowed. Koma Motion still opens such a
 *   file, but removes them with a warning, so they are not part of the format.
 *
 * Rules that JSON Schema cannot express are not included: unique identifiers,
 * references between Komas, transitions and assets, colour normalisation,
 * the 64 MiB file limit and the limits of extension data.
 * See docs/PROJECT_FORMAT.md.
 */
export function createProjectJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(komaProjectSchema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'throw',
    override: ({ zodSchema, jsonSchema, path }) => {
      if (!(zodSchema instanceof z.ZodObject) || jsonSchema.type !== 'object') {
        return;
      }
      if (path.length === 0) {
        jsonSchema.additionalProperties = { description: EXTENSION_DATA_DESCRIPTION };
      } else if (jsonSchema.additionalProperties === undefined) {
        jsonSchema.additionalProperties = false;
      }
    },
  });
  const { $schema, ...rest } = generated;
  return {
    $schema,
    $id: PROJECT_JSON_SCHEMA_ID,
    title: `Koma Motion project, format version ${String(CURRENT_SCHEMA_VERSION)}`,
    description:
      'A Koma Motion project file (.koma). Generated from the runtime schema; do not edit by hand. ' +
      'Run `pnpm schema:generate` to update it. Koma Motion validates further rules at runtime ' +
      'that JSON Schema cannot express; see docs/PROJECT_FORMAT.md.',
    ...rest,
  };
}

/** The canonical text of the published schema file, with a final newline. */
export function formatProjectJsonSchema(): string {
  return `${JSON.stringify(createProjectJsonSchema(), null, 2)}\n`;
}
