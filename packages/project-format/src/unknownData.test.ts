import { buildKoma, buildPresentation, buildProject, buildShape } from '@koma-motion/core/testing';
import { CURRENT_SCHEMA_VERSION } from '@koma-motion/core';
import { describe, expect, it } from 'vitest';
import { parseProject } from './parse';
import { serialiseProject } from './serialise';

// The policy these tests protect is described in docs/PROJECT_FORMAT.md,
// section "Unknown data".

function open(text: string) {
  const result = parseProject(text);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

function save(project: Parameters<typeof serialiseProject>[0]): string {
  const result = serialiseProject(project);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

function documentWithUnknownData(): Record<string, unknown> {
  const project = buildProject({
    agentConfiguration: {
      selectedProviderId: 'mock',
      timeoutSeconds: null,
      providers: { 'future-provider': { model: null } },
    },
    presentation: buildPresentation({
      komas: [buildKoma({ id: 'koma-1', elements: [buildShape({ id: 'shape-1' })] })],
    }),
  });
  const koma = project.presentation.komas[0];
  const shape = koma?.elements[0];
  if (koma === undefined || shape === undefined) {
    throw new Error('Expected a Koma with an element');
  }
  return {
    ...project,
    futureFeature: { enabled: true },
    brandKit: { ...project.brandKit, mascot: 'fox' },
    presentation: {
      ...project.presentation,
      komas: [
        {
          ...koma,
          intermediate: true,
          elements: [{ ...shape, style: { ...shape.style, shadow: '#000000' } }],
        },
      ],
    },
    agentConfiguration: {
      ...project.agentConfiguration,
      providers: { 'future-provider': { model: null, temperature: 1 } },
    },
  };
}

describe('unknown data policy', () => {
  it('keeps unknown top-level properties and removes reported nested ones on save', () => {
    const opened = open(JSON.stringify(documentWithUnknownData()));

    const reported = [
      'brandKit.mascot',
      'presentation.komas[0].intermediate',
      'presentation.komas[0].elements[0].style.shadow',
      'agentConfiguration.providers.future-provider.temperature',
    ];
    for (const path of reported) {
      expect(opened.warnings.some((warning) => warning.includes(`"${path}"`))).toBe(true);
    }
    expect(opened.warnings.some((warning) => warning.includes('futureFeature'))).toBe(false);

    const reopened = open(save(opened.project));
    expect(reopened.warnings).toEqual([]);
    const saved: Record<string, unknown> = { ...reopened.project };
    expect(saved['futureFeature']).toEqual({ enabled: true });
    expect(reopened.project.brandKit).not.toHaveProperty('mascot');
    expect(reopened.project.presentation.komas[0]).not.toHaveProperty('intermediate');
    expect(reopened.project.presentation.komas[0]?.elements[0]?.style).not.toHaveProperty('shadow');
    // Entries of maps are data, not properties: an unknown provider id is kept.
    expect(reopened.project.agentConfiguration.providers).toEqual({
      'future-provider': { model: null },
    });
  });

  it('keeps unknown top-level properties through a migration', () => {
    const opened = open(
      JSON.stringify({
        ...buildProject(),
        schemaVersion: CURRENT_SCHEMA_VERSION - 1,
        futureFeature: [1, 2, 3],
      }),
    );
    expect(opened.migratedFrom).toBe(CURRENT_SCHEMA_VERSION - 1);
    const saved: Record<string, unknown> = { ...opened.project };
    expect(saved['futureFeature']).toEqual([1, 2, 3]);
  });

  it('rejects unknown values of known properties instead of removing them', () => {
    const project = buildProject();
    const koma = project.presentation.komas[0];
    const element = koma?.elements[0];
    if (koma === undefined || element === undefined) {
      throw new Error('Expected a Koma with an element');
    }
    const result = parseProject(
      JSON.stringify({
        ...project,
        presentation: {
          ...project.presentation,
          komas: [{ ...koma, elements: [{ ...element, type: 'video' }] }],
        },
      }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'invalidProject' } });
  });

  it('neither opens nor migrates down a newer format, even when it only adds data', () => {
    const result = parseProject(
      JSON.stringify({
        ...buildProject(),
        schemaVersion: CURRENT_SCHEMA_VERSION + 1,
        futureFeature: true,
      }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'newerSchemaVersion' } });
  });
});
