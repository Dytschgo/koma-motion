import { buildKoma, buildPresentation, buildProject, buildShape } from '@koma-motion/core/testing';
import { CURRENT_SCHEMA_VERSION } from '@koma-motion/core';
import { buildTransition, computeFrame, komaToFrame } from '@koma-motion/motion-engine';
import { describe, expect, it } from 'vitest';
import { migrateToVersion, type Migration } from './migrations';
import { parseProject } from './parse';
import { serialiseProject, touchProject } from './serialise';
import { findDroppedFields } from './unknownFields';

function serialise(project: Parameters<typeof serialiseProject>[0]): string {
  const result = serialiseProject(project);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseKeys);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, child]) => [key, reverseKeys(child)]),
    );
  }
  return value;
}

describe('serialiseProject', () => {
  it('produces human-readable text that starts with the format marker', () => {
    const text = serialise(buildProject());
    expect(
      text.startsWith(
        `{\n  "format": "koma-motion-project",\n  "schemaVersion": ${String(CURRENT_SCHEMA_VERSION)},`,
      ),
    ).toBe(true);
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('is deterministic for repeated calls', () => {
    expect(serialise(buildProject())).toBe(serialise(buildProject()));
  });

  it('does not depend on the property order of the input', () => {
    const project = buildProject({
      agentConfiguration: {
        selectedProviderId: 'mock',
        timeoutSeconds: 300,
        providers: { mock: { model: null }, 'claude-code': { model: 'claude-opus-5-5' } },
      },
    });
    const parsed = parseProject(JSON.stringify(reverseKeys(project)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(serialise(parsed.value.project)).toBe(serialise(project));
    }
  });

  it('refuses to serialise an invalid project', () => {
    const project = buildProject();
    const result = serialiseProject({ ...project, name: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalidProject');
      expect(result.error.issues[0]?.path).toBe('name');
    }
  });

  it('keeps unknown top-level data across a round trip', () => {
    const text = serialise({ ...buildProject(), futureFeature: { b: 2, a: 1 } });
    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.project['futureFeature']).toEqual({ a: 1, b: 2 });
      expect(serialise(parsed.value.project)).toBe(text);
    }
  });

  it('keeps multibyte extension text across a round trip', () => {
    const text = serialise({ ...buildProject(), futureFeature: { label: 'café' } });
    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.project['futureFeature']).toEqual({ label: 'café' });
      expect(serialise(parsed.value.project)).toBe(text);
    }
  });
});

describe('parseProject', () => {
  it('reports failed post-migration validation without changing the supplied document', () => {
    const document = { ...buildProject(), schemaVersion: 1, name: '' };
    const before = JSON.stringify(document);
    const parsed = parseProject(before);
    expect(parsed).toMatchObject({ ok: false, error: { code: 'migrationFailed' } });
    expect(JSON.stringify(document)).toBe(before);
  });
  it('reports an unplayable stored transition without rewriting the project', () => {
    const source = buildShape({
      id: 'shape-1',
      persistentId: 'marker',
      position: { x: 40, y: 80 },
    });
    const target = { ...source, id: 'shape-2', position: { x: 400, y: 80 } };
    const from = buildKoma({ id: 'koma-1', title: 'Start', elements: [source] });
    const to = buildKoma({ id: 'koma-2', title: 'End', elements: [target] });
    const built = buildTransition({ id: 'transition-1', from, to });
    if (!built.ok) {
      throw new Error('Expected a transition');
    }
    const invented = {
      ...built.value.transition,
      elementTransitions: [
        {
          persistentId: 'marker',
          operation: 'move' as const,
          from: { elementId: 'shape-1', position: { x: 1, y: 2 } },
          to: { elementId: 'missing-shape', position: { x: 9000, y: 9000 } },
        },
      ],
    };
    const project = buildProject({
      presentation: buildPresentation({ komas: [from, to], transitions: [invented] }),
    });
    const text = serialise(project);
    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(parsed.value.warnings.some((warning) => warning.includes('missing-shape'))).toBe(true);
    expect(serialise(parsed.value.project)).toBe(text);
    expect(parsed.value.project.presentation.transitions[0]?.elementTransitions).toEqual(
      invented.elementTransitions,
    );

    const middle = computeFrame({ from, to, transition: invented, progress: 0.5 });
    expect(
      middle.layers.find((layer) => layer.persistentId === 'marker')?.element.position,
    ).toEqual(source.position);
    expect(computeFrame({ from, to, transition: invented, progress: 0 })).toEqual(
      komaToFrame(from),
    );
    expect(computeFrame({ from, to, transition: invented, progress: 1 })).toEqual(komaToFrame(to));
  });

  it('round-trips a project without losing content', () => {
    const project = buildProject();
    const parsed = parseProject(serialise(project));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.project).toEqual(project);
      expect(parsed.value.warnings).toEqual([]);
      expect(parsed.value.migratedFrom).toBeNull();
    }
  });

  it('rejects text that is not JSON', () => {
    const result = parseProject('{ "format": ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalidJson');
    }
  });

  it.each([
    ['another JSON document', '{"name":"package"}'],
    ['an array', '[]'],
    ['a missing version', '{"format":"koma-motion-project"}'],
    ['a version that is not a number', '{"format":"koma-motion-project","schemaVersion":"1"}'],
  ])('rejects %s', (_label, text) => {
    const result = parseProject(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('notAProject');
    }
  });

  it('refuses projects written by a newer version', () => {
    const result = parseProject(
      JSON.stringify({ ...buildProject(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('newerSchemaVersion');
      expect(result.error.message).toContain('Update Koma Motion');
    }
  });

  it('explains where a project is invalid', () => {
    const project = buildProject();
    const broken = {
      ...project,
      presentation: { ...project.presentation, aspectRatio: '21:9' },
    };
    const result = parseProject(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalidProject');
      expect(result.error.issues[0]?.path).toBe('presentation.aspectRatio');
      expect(result.error.message).toContain('presentation.aspectRatio');
    }
  });

  it('warns about unknown nested properties instead of dropping them silently', () => {
    const project = buildProject();
    const withUnknown = {
      ...project,
      brandKit: { ...project.brandKit, mascot: 'fox' },
    };
    const result = parseProject(JSON.stringify(withUnknown));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warnings).toHaveLength(1);
      expect(result.value.warnings[0]).toContain('brandKit.mascot');
    }
  });

  it('warns about missing assets', () => {
    const project = buildProject();
    const result = parseProject(
      JSON.stringify({ ...project, brandKit: { ...project.brandKit, logoAssetId: 'asset-gone' } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warnings[0]).toContain('asset-gone');
    }
  });
});

describe('migrateToVersion', () => {
  const migrations: readonly Migration[] = [
    { fromVersion: 1, migrate: (document) => ({ ...document, second: true }) },
    { fromVersion: 2, migrate: (document) => ({ ...document, third: true }) },
  ];

  it('applies every migration in order', () => {
    const result = migrateToVersion({ schemaVersion: 1 }, 1, 3, migrations);
    expect(result).toEqual({
      ok: true,
      value: { document: { schemaVersion: 3, second: true, third: true }, migratedFrom: 1 },
    });
  });

  it('does nothing for the current version', () => {
    const document = { schemaVersion: 3 };
    const result = migrateToVersion(document, 3, 3, migrations);
    expect(result).toEqual({ ok: true, value: { document, migratedFrom: null } });
  });

  it('fails when a migration is missing', () => {
    const result = migrateToVersion({ schemaVersion: 1 }, 1, 3, [migrations[1]!]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unsupportedSchemaVersion');
    }
  });

  it('returns a recoverable error when a migration throws, without changing its input', () => {
    const document = { schemaVersion: 1, custom: 'keep' };
    const result = migrateToVersion(document, 1, 2, [
      {
        fromVersion: 1,
        migrate: () => {
          throw new Error('Internal implementation detail');
        },
      },
    ]);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'migrationFailed',
      },
    });
    if (!result.ok) expect(result.error.message).toContain('could not be completed');
    expect(document).toEqual({ schemaVersion: 1, custom: 'keep' });
  });
});

describe('touchProject', () => {
  it('updates only the modification time', () => {
    const project = buildProject();
    const touched = touchProject(project, '2026-09-29T12:00:00.000Z');
    expect(touched.updatedAt).toBe('2026-09-29T12:00:00.000Z');
    expect(touched.createdAt).toBe(project.createdAt);
    expect({ ...touched, updatedAt: project.updatedAt }).toEqual(project);
  });
});

describe('findDroppedFields', () => {
  it('finds nested properties and array items', () => {
    expect(
      findDroppedFields(
        { a: 1, list: [{ keep: 1, drop: 2 }], nested: { keep: 1, drop: 2 } },
        { a: 1, list: [{ keep: 1 }], nested: { keep: 1 } },
      ),
    ).toEqual(['list[0].drop', 'nested.drop']);
  });
});
