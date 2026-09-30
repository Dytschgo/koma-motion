import { createSeededIdGenerator, type KomaProject } from '@koma-motion/core';
import { buildKoma, buildPresentation, buildProject, buildShape } from '@koma-motion/core/testing';
import { syncTransitions } from '@koma-motion/motion-engine';
import { describe, expect, it } from 'vitest';
import { collectHealthIssues } from './projectHealth';

const shape = buildShape({ id: 'shape-1', persistentId: 'shape' });
const presentation = syncTransitions(
  buildPresentation({
    komas: [
      buildKoma({ id: 'first', elements: [shape] }),
      buildKoma({
        id: 'second',
        elements: [{ ...shape, id: 'shape-2', position: { x: 300, y: 100 } }],
      }),
    ],
    transitions: [],
  }),
  createSeededIdGenerator('health'),
).presentation;
const transition = presentation.transitions[0];
if (!transition) throw new Error('Expected transition');

describe('project motion health', () => {
  it('does not call a skipped future effect blocking when other motion can play', () => {
    const project: KomaProject = {
      ...buildProject(),
      presentation: {
        ...presentation,
        transitions: [
          {
            ...transition,
            elementTransitions: [
              {
                persistentId: 'shape',
                // Exercise the renderer's defensive path for a future runtime value.
                // @ts-expect-error The current file schema rejects future operations.
                operation: 'morph',
                from: { elementId: 'shape-1' },
                to: { elementId: 'shape-2' },
              },
            ],
          },
        ],
      },
    };
    const issues = collectHealthIssues(project, [], null);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'info' });
    expect(issues[0]?.message).toContain('supported motion can still play');
  });

  it('still marks invalid references as blocking', () => {
    const project: KomaProject = {
      ...buildProject(),
      presentation: {
        ...presentation,
        transitions: [
          {
            ...transition,
            elementTransitions: [
              {
                persistentId: 'shape',
                operation: 'move',
                from: { elementId: 'missing' },
                to: { elementId: 'shape-2' },
              },
            ],
          },
        ],
      },
    };
    const issues = collectHealthIssues(project, [], null);
    expect(
      issues.some(
        (issue) =>
          issue.severity === 'blocked' && issue.message.includes('Interpolation is blocked'),
      ),
    ).toBe(true);
  });
});
