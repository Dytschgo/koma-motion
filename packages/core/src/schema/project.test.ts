import { describe, expect, it } from 'vitest';
import { collectProjectWarnings } from '../projectWarnings';
import {
  buildKoma,
  buildPresentation,
  buildProject,
  buildShape,
  buildText,
} from '../testing/fixtures';
import { toValidationIssues } from '../validation';
import { projectPathSchema } from './asset';
import { komaSchema } from './koma';
import { findTransitionStructureIssues } from './presentation';
import { komaProjectSchema } from './project';

describe('komaProjectSchema', () => {
  it('accepts a valid project', () => {
    expect(komaProjectSchema.safeParse(buildProject()).success).toBe(true);
  });

  it('rejects an unknown schema version', () => {
    const result = komaProjectSchema.safeParse({ ...buildProject(), schemaVersion: 2 });
    expect(result.success).toBe(false);
  });

  it('reports the location of invalid values', () => {
    const project = buildProject();
    const broken = {
      ...project,
      brandKit: { ...project.brandKit, colours: { ...project.brandKit.colours, primary: 'red' } },
    };
    const result = komaProjectSchema.safeParse(broken);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = toValidationIssues(result.error);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.path).toBe('brandKit.colours.primary');
      expect(issues[0]?.message).toContain('six-digit hex');
    }
  });

  it('keeps unknown top-level properties', () => {
    const result = komaProjectSchema.parse({ ...buildProject(), futureFeature: { enabled: true } });
    expect(result.futureFeature).toEqual({ enabled: true });
  });

  it('rejects unsupported element types', () => {
    const project = buildProject();
    const koma = { ...buildKoma(), elements: [{ ...buildShape(), type: 'video' }] };
    const result = komaProjectSchema.safeParse({
      ...project,
      presentation: { ...project.presentation, komas: [koma] },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toValidationIssues(result.error)[0]?.path).toBe(
        'presentation.komas[0].elements[0].type',
      );
    }
  });

  it('rejects transitions that refer to missing Komas', () => {
    const project = buildProject();
    const result = komaProjectSchema.safeParse({
      ...project,
      presentation: {
        ...project.presentation,
        transitions: [
          {
            id: 'transition-1',
            fromKomaId: 'koma-1',
            toKomaId: 'koma-missing',
            strategy: 'continuous',
            duration: 900,
            easing: 'easeInOut',
            elementTransitions: [],
            rationale: '',
          },
        ],
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toValidationIssues(result.error)[0]?.message).toContain('koma-missing');
    }
  });

  it('rejects duplicate Koma ids', () => {
    const project = buildProject();
    const result = komaProjectSchema.safeParse({
      ...project,
      presentation: { ...project.presentation, komas: [buildKoma(), buildKoma()] },
    });
    expect(result.success).toBe(false);
  });
});

describe('komaSchema', () => {
  it('rejects duplicate persistent ids inside one Koma', () => {
    const koma = buildKoma({
      elements: [buildShape(), buildText({ persistentId: 'shape' })],
    });
    const result = komaSchema.safeParse(koma);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toValidationIssues(result.error)[0]).toMatchObject({
        path: 'elements[1].persistentId',
      });
    }
  });

  it('rejects duplicate element ids inside one Koma', () => {
    const koma = buildKoma({
      elements: [buildShape(), buildText({ id: 'element-shape' })],
    });
    expect(komaSchema.safeParse(koma).success).toBe(false);
  });

  it('rejects sizes that are not positive', () => {
    const koma = buildKoma({ elements: [buildShape({ size: { width: 0, height: 10 } })] });
    expect(komaSchema.safeParse(koma).success).toBe(false);
  });
});

describe('projectPathSchema', () => {
  it.each(['assets/logo.png', 'logo.png', 'assets/brand/logo-1.png'])('accepts %s', (path) => {
    expect(projectPathSchema.safeParse(path).success).toBe(true);
  });

  it.each([
    '/etc/passwd',
    '../secret.png',
    'assets/../../secret.png',
    'C:\\Users\\me\\logo.png',
    'assets\\logo.png',
    './logo.png',
    'file:///logo.png',
  ])('rejects %s', (path) => {
    expect(projectPathSchema.safeParse(path).success).toBe(false);
  });
});

describe('collectProjectWarnings', () => {
  it('reports images whose asset is missing', () => {
    const project = buildProject();
    const koma = buildKoma({
      elements: [
        {
          ...buildShape(),
          type: 'image',
          name: 'Photo',
          content: { assetId: 'asset-missing', altText: '' },
          style: { fit: 'contain', cornerRadius: 0 },
        },
      ],
    });
    const warnings = collectProjectWarnings({
      ...project,
      presentation: { ...project.presentation, komas: [koma] },
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe('missingAsset');
  });

  it('reports a missing logo asset', () => {
    const project = buildProject();
    const warnings = collectProjectWarnings({
      ...project,
      brandKit: { ...project.brandKit, logoAssetId: 'asset-logo' },
    });
    expect(warnings.map((warning) => warning.code)).toEqual(['missingLogoAsset']);
  });

  it('reports nothing for a complete project', () => {
    expect(collectProjectWarnings(buildProject())).toEqual([]);
  });
});

describe('findTransitionStructureIssues', () => {
  it('reports a false element reference without rejecting the project', () => {
    const source = buildShape({ id: 'shape-1', persistentId: 'marker' });
    const target = { ...source, id: 'shape-2', position: { x: 400, y: 100 } };
    const project = buildProject({
      presentation: buildPresentation({
        komas: [
          buildKoma({ id: 'koma-1', title: 'Start', elements: [source] }),
          buildKoma({ id: 'koma-2', title: 'End', elements: [target] }),
        ],
        transitions: [
          {
            id: 'transition-1',
            fromKomaId: 'koma-1',
            toKomaId: 'koma-2',
            strategy: 'continuous',
            duration: 900,
            easing: 'linear',
            rationale: '',
            elementTransitions: [
              {
                persistentId: 'marker',
                operation: 'move',
                from: { elementId: 'shape-1', position: { x: 1, y: 2 } },
                to: { elementId: 'missing-shape', position: { x: 9000, y: 9000 } },
              },
            ],
          },
        ],
      }),
    });

    expect(komaProjectSchema.safeParse(project).success).toBe(true);
    const transition = project.presentation.transitions[0];
    if (transition === undefined) {
      throw new Error('Expected a transition');
    }
    expect(
      findTransitionStructureIssues(project.presentation, transition).map((issue) => issue.code),
    ).toEqual(['wrongElementId']);
  });
});
