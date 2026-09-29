import { createSeededIdGenerator, komaProjectSchema, type Presentation } from '@koma-motion/core';
import { buildBrandKit, buildProject } from '@koma-motion/core/testing';
import { validateTransition } from '@koma-motion/motion-engine';
import { describe, expect, it } from 'vitest';
import { buildGenerationRequest } from '../../contract/request';
import { convertResponseToPresentation } from '../../conversion/toPresentation';
import { presentationGenerationPromptV1 } from '../../prompts/presentationGeneration';
import { getResponseJsonSchema } from '../../contract/response';
import { buildRequest } from '../../testing/fixtures';
import { validateAgentResponse } from '../../validation/validateResponse';
import type { AgentExecutionContext } from '../types';
import { MockAgentProvider } from './MockAgentProvider';
import { buildMockResponse } from './mockStory';

function context(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  const request = buildRequest();
  return {
    executionId: 'execution-1',
    attempt: 1,
    prompt: presentationGenerationPromptV1.render({
      request,
      responseJsonSchema: getResponseJsonSchema(),
    }),
    model: null,
    signal: new AbortController().signal,
    reportProgress: () => undefined,
    ...overrides,
  };
}

function convert(request = buildRequest()): Presentation {
  const validated = validateAgentResponse(buildMockResponse(request), request);
  if (!validated.ok) {
    throw new Error(validated.error.message);
  }
  const converted = convertResponseToPresentation(validated.value.response, {
    request,
    idGenerator: createSeededIdGenerator('mock-test'),
  });
  if (!converted.ok) {
    throw new Error(converted.error.message);
  }
  expect(converted.value.warnings).toEqual([]);
  return converted.value.presentation;
}

function operations(presentation: Presentation, index: number, persistentId: string): string[] {
  return (presentation.transitions[index]?.elementTransitions ?? [])
    .filter((transition) => transition.persistentId === persistentId)
    .map((transition) => transition.operation);
}

describe('MockAgentProvider', () => {
  const provider = new MockAgentProvider({ delayMs: 0 });

  it('is always available', async () => {
    const detection = await provider.detect();
    expect(detection).toMatchObject({ providerId: 'mock', availability: 'available' });
    expect(provider.metadata.usesExternalService).toBe(false);
  });

  it('produces the same output for the same input and Brand Kit', async () => {
    const first = await provider.generatePresentation(buildRequest(), context());
    const second = await provider.generatePresentation(buildRequest(), context());
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.output.rawText).toBe(second.output.rawText);
    }
  });

  it('reports progress', async () => {
    const messages: string[] = [];
    await provider.generatePresentation(
      buildRequest(),
      context({ reportProgress: (message) => messages.push(message) }),
    );
    expect(messages).toHaveLength(3);
  });

  it('stops when it is cancelled', async () => {
    const controller = new AbortController();
    const slow = new MockAgentProvider({ delayMs: 60_000 });
    const pending = slow.generatePresentation(
      buildRequest(),
      context({ signal: controller.signal }),
    );
    controller.abort();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('cancelled');
    }
  });
});

describe('the demonstration story', () => {
  const presentation = convert();

  it('contains three valid Komas with two transitions', () => {
    expect(presentation.komas.map((koma) => koma.title)).toEqual([
      'One connected system',
      'The motion engine',
      'Motion you can edit',
    ]);
    expect(presentation.transitions).toHaveLength(2);
    const project = buildProject({ presentation });
    expect(komaProjectSchema.safeParse(project).success).toBe(true);
  });

  it('keeps the motion engine as one object that moves and scales', () => {
    const engines = presentation.komas.map((koma) =>
      koma.elements.find((element) => element.persistentId === 'motion-engine'),
    );
    expect(engines.every((engine) => engine?.type === 'shape')).toBe(true);
    expect(new Set(engines.map((engine) => engine?.id)).size).toBe(3);

    expect(operations(presentation, 0, 'motion-engine')).toEqual(['move', 'scale']);
    expect(operations(presentation, 1, 'motion-engine')).toEqual(['move', 'scale']);

    const [first, second] = engines;
    expect(second?.size.width).toBeGreaterThan(first?.size.width ?? Infinity);
    const centre = (second?.position.x ?? 0) + (second?.size.width ?? 0) / 2;
    expect(centre).toBe(960);
  });

  it('contains entering, exiting, unchanged and replaced objects', () => {
    expect(operations(presentation, 0, 'engine-halo')).toEqual(['fadeIn']);
    expect(operations(presentation, 0, 'link-1')).toEqual(['fadeOut']);
    expect(operations(presentation, 0, 'wordmark')).toEqual(['hold']);
    expect(operations(presentation, 1, 'wordmark')).toEqual(['hold']);
    expect(operations(presentation, 0, 'title')).toEqual(['replace']);
    expect(operations(presentation, 0, 'node-agents')).toEqual(['move', 'scale', 'fadeOut']);
    expect(operations(presentation, 1, 'node-agents')).toEqual(['fadeOut']);
    expect(operations(presentation, 1, 'point-text')).toEqual(['fadeIn']);
    expect(operations(presentation, 1, 'node-output')).toEqual(['move', 'scale', 'fadeIn']);
  });

  it('has transitions that pass validation and explain themselves', () => {
    for (const transition of presentation.transitions) {
      expect(validateTransition(transition, presentation)).toEqual([]);
      expect(transition.rationale.length).toBeGreaterThan(40);
      expect(transition.strategy).toBe('staged');
      expect(transition.duration).toBe(1600);
    }
  });

  it('uses the colours of the Brand Kit', () => {
    const brandKit = buildBrandKit({
      colours: {
        primary: '#00AA88',
        secondary: '#113355',
        accent: '#FFCC00',
        background: '#FFFFFF',
        text: '#111111',
      },
    });
    const request = buildGenerationRequest(
      buildProject({ brandKit, presentation: { ...buildProject().presentation, komas: [] } }),
      {
        userRequest: 'Introduce Koma Motion',
        objective: null,
        audience: null,
        requestedKomaCount: 3,
      },
    );
    const branded = convert(request);

    const colours = new Set<string>();
    for (const koma of branded.komas) {
      colours.add(koma.background.colour);
      for (const element of koma.elements) {
        if (element.type === 'text') {
          colours.add(element.style.colour);
        } else if (element.type === 'shape') {
          for (const colour of [element.style.fill, element.style.stroke]) {
            if (colour !== null) {
              colours.add(colour);
            }
          }
        }
      }
    }
    expect([...colours].sort()).toEqual(['#00AA88', '#111111', '#113355', '#FFCC00', '#FFFFFF']);
  });

  it('keeps every element inside the canvas', () => {
    for (const aspectRatio of ['16:9', '4:3'] as const) {
      const project = buildProject();
      const request = buildGenerationRequest(
        { ...project, presentation: { ...project.presentation, aspectRatio, komas: [] } },
        {
          userRequest: 'Introduce Koma Motion',
          objective: null,
          audience: null,
          requestedKomaCount: null,
        },
      );
      for (const koma of convert(request).komas) {
        for (const element of koma.elements) {
          expect(element.position.x).toBeGreaterThanOrEqual(0);
          expect(element.position.y).toBeGreaterThanOrEqual(0);
          expect(element.position.x + element.size.width).toBeLessThanOrEqual(request.canvas.width);
          expect(element.position.y + element.size.height).toBeLessThanOrEqual(
            request.canvas.height,
          );
        }
      }
    }
  });

  it('creates the same identifiers for the same seed', () => {
    expect(convert()).toEqual(convert());
  });

  it('explains when another number of Komas was requested', () => {
    const response = buildMockResponse(buildRequest({ requestedKomaCount: 5 }));
    expect(response.warnings).toHaveLength(1);
    expect(response.komas).toHaveLength(3);
  });
});
