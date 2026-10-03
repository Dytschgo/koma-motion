import { CURRENT_SCHEMA_VERSION, komaSchema } from '@koma-motion/core';
import { buildKoma, buildProject } from '@koma-motion/core/testing';
import { describe, expect, it } from 'vitest';
import { parseProject } from './parse';
import { serialiseProject } from './serialise';

describe('saved Koma hold timing', () => {
  it.each([1, 2, 3, 4])(
    'migrates v%i to global timing without activating unknown legacy timing',
    (schemaVersion) => {
      const source = buildProject();
      const legacy = {
        ...source,
        schemaVersion,
        presentation: {
          ...source.presentation,
          komas: [
            { ...buildKoma({ id: 'one' }), holdDurationMs: 2000 },
            { ...buildKoma({ id: 'two' }), holdDurationMs: { untrusted: true } },
            { ...buildKoma({ id: 'three' }), holdDurationMs: undefined },
          ],
        },
      };
      const text = JSON.stringify(legacy);
      const parsed = parseProject(text);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error(parsed.error.message);
      expect(parsed.value.migratedFrom).toBe(schemaVersion);
      expect(parsed.value.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(parsed.value.project.presentation.komas.map((koma) => koma.holdDurationMs)).toEqual([
        null,
        null,
        null,
      ]);
      expect(parsed.value.project.presentation.transitions).toEqual(
        source.presentation.transitions,
      );
      expect(JSON.stringify(legacy)).toBe(text);
    },
  );

  it('round-trips explicit and global holds in the current format', () => {
    const project = buildProject();
    project.presentation.komas = [
      buildKoma({ id: 'one', holdDurationMs: 1250 }),
      buildKoma({ id: 'two', holdDurationMs: 60000 }),
      buildKoma({ id: 'three' }),
    ];
    const saved = serialiseProject(project);
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.error.message);
    expect(parseProject(saved.value)).toMatchObject({
      ok: true,
      value: { migratedFrom: null, project },
    });
  });

  it.each([0, 999, 60001, 1500.5, '2000', Infinity, -1])(
    'rejects invalid current hold duration %s',
    (holdDurationMs) => {
      expect(komaSchema.safeParse({ ...buildKoma(), holdDurationMs }).success).toBe(false);
      const project = buildProject();
      const text = JSON.stringify({
        ...project,
        presentation: { ...project.presentation, komas: [{ ...buildKoma(), holdDurationMs }] },
      });
      if (holdDurationMs !== Infinity)
        expect(parseProject(text)).toMatchObject({ ok: false, error: { code: 'invalidProject' } });
    },
  );

  it('defaults an omitted current hold to global and refuses future versions', () => {
    const { holdDurationMs: _hold, ...koma } = buildKoma();
    expect(komaSchema.parse(koma).holdDurationMs).toBeNull();
    expect(
      parseProject(
        JSON.stringify({ ...buildProject(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 }),
      ),
    ).toMatchObject({ ok: false, error: { code: 'newerSchemaVersion' } });
  });

  it('does not repair a malformed legacy Koma while adding timing defaults', () => {
    const project = buildProject();
    expect(
      parseProject(
        JSON.stringify({
          ...project,
          schemaVersion: 4,
          presentation: { ...project.presentation, komas: [null] },
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: 'migrationFailed' } });
  });
});
