import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '@koma-motion/core';
import { buildProject } from '@koma-motion/core/testing';
import { parseProject } from './parse';
import { serialiseProject } from './serialise';

describe('reasoning preference format', () => {
  it('round-trips flexible values at project/provider/model scope', () => {
    const project = buildProject();
    project.agentConfiguration.providers['codex'] = {
      model: 'fixture',
      reasoningByModel: { fixture: 'deep-v2', second: '64000' },
    };
    const text = serialiseProject(project);
    expect(text.ok).toBe(true);
    if (!text.ok) return;
    const restored = parseProject(text.value);
    expect(restored.ok).toBe(true);
    if (restored.ok)
      expect(restored.value.project.agentConfiguration).toEqual(project.agentConfiguration);
  });
  it.each([1, 2, 3])(
    'migrates version %i without activating old unknown reasoning data',
    (schemaVersion) => {
      const project = buildProject();
      const previous = {
        ...project,
        schemaVersion,
        agentConfiguration: {
          ...project.agentConfiguration,
          providers: {
            codex: { model: 'saved-custom', reasoningByModel: { 'saved-custom': 'surprise' } },
          },
        },
      };
      const result = parseProject(JSON.stringify(previous));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(result.value.project.agentConfiguration.providers['codex']).toEqual({
          model: 'saved-custom',
        });
      }
    },
  );
  it('rejects malformed saved reasoning instead of passing it to a CLI', () => {
    const project = buildProject();
    project.agentConfiguration.providers['codex'] = {
      model: 'fixture',
      reasoningByModel: { fixture: '--effort\nsecret' },
    };
    expect(parseProject(JSON.stringify(project)).ok).toBe(false);
  });
});
