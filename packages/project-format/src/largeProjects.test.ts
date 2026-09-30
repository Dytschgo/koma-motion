import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  MAX_AGENT_TIMEOUT_SECONDS,
  agentConfigurationSchema,
} from '@koma-motion/core';
import { buildProject } from '@koma-motion/core/testing';
import { parseProject } from './parse';
import { serialiseProject } from './serialise';

it.each([1, 2])(
  'migrates version %i to no automatic deadline and retains project content',
  (schemaVersion) => {
    const project = buildProject({
      systemInstructions: schemaVersion === 1 ? '' : 'Keep the project guidance.',
    });
    const raw = {
      ...project,
      schemaVersion,
      agentConfiguration: { ...project.agentConfiguration, timeoutSeconds: 900 },
      futureExtension: { keep: true },
    };
    const migrated = parseProject(JSON.stringify(raw));
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.value.project.agentConfiguration.timeoutSeconds).toBeNull();
    expect(migrated.value.project.systemInstructions).toBe(project.systemInstructions);
    expect(migrated.value.project.presentation).toEqual(project.presentation);
    expect(migrated.value.project.futureExtension).toEqual({ keep: true });
    expect(migrated.value.warnings.join(' ')).toContain('old automatic time limit was disabled');
    const saved = serialiseProject(migrated.value.project);
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      const reopened = parseProject(saved.value);
      expect(reopened.ok && reopened.value.project).toEqual(migrated.value.project);
    }
  },
);

describe('deadline storage', () => {
  it.each([null, 7200, MAX_AGENT_TIMEOUT_SECONDS])(
    'round-trips optional deadline %s',
    (timeoutSeconds) => {
      const project = buildProject();
      project.agentConfiguration.timeoutSeconds = timeoutSeconds;
      const encoded = serialiseProject(project);
      expect(encoded.ok).toBe(true);
      if (encoded.ok) {
        const loaded = parseProject(encoded.value);
        expect(loaded.ok && loaded.value.project.agentConfiguration.timeoutSeconds).toBe(
          timeoutSeconds,
        );
      }
    },
  );
  it('rejects timer overflow and malformed settings', () => {
    const configuration = buildProject().agentConfiguration;
    for (const timeoutSeconds of [MAX_AGENT_TIMEOUT_SECONDS + 1, NaN, -1, 'forever']) {
      expect(agentConfigurationSchema.safeParse({ ...configuration, timeoutSeconds }).success).toBe(
        false,
      );
    }
  });
});
