import { describe, expect, it } from 'vitest';
import { buildProject } from '../testing/fixtures';
import { createProjectJsonSchema, formatProjectJsonSchema } from './jsonSchema';
import { CURRENT_SCHEMA_VERSION, komaProjectSchema } from './project';

interface JsonSchemaObject {
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: unknown;
}

function isJsonSchemaObject(value: unknown): value is JsonSchemaObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function property(schema: unknown, name: string): JsonSchemaObject {
  if (!isJsonSchemaObject(schema) || !isJsonSchemaObject(schema.properties?.[name])) {
    throw new Error(`The schema has no property "${name}"`);
  }
  return schema.properties[name];
}

describe('published JSON Schema of the project format', () => {
  // Regenerate with `pnpm schema:generate` after a schema change.
  it('matches the runtime schema', async () => {
    await expect(formatProjectJsonSchema()).toMatchFileSnapshot(
      '../../../../docs/schema/koma-project.schema.json',
    );
  });

  it('describes the current format version', () => {
    const schema = createProjectJsonSchema();
    expect(property(schema, 'schemaVersion')).toMatchObject({ const: CURRENT_SCHEMA_VERSION });
    expect(property(schema, 'format')).toMatchObject({ const: 'koma-motion-project' });
  });

  it('allows extension data at the top level and nothing unknown below it', () => {
    const schema = createProjectJsonSchema();
    expect(isJsonSchemaObject(schema)).toBe(true);
    if (!isJsonSchemaObject(schema)) return;
    expect(schema.additionalProperties).toMatchObject({
      description: expect.stringContaining('Extension data') as unknown,
    });
    expect(property(schema, 'brandKit').additionalProperties).toBe(false);
    expect(property(schema, 'presentation').additionalProperties).toBe(false);
    // Maps keep their entries; only their values are closed objects.
    const providers = property(property(schema, 'agentConfiguration'), 'providers');
    expect(providers.additionalProperties).toMatchObject({ additionalProperties: false });
  });

  it('requires every top-level property a saved project always contains', () => {
    const saved = Object.keys(komaProjectSchema.parse(buildProject())).filter(
      // Read as an empty string when it is missing.
      (key) => key !== 'systemInstructions',
    );
    expect(createProjectJsonSchema()['required']).toEqual(saved);
  });
});
