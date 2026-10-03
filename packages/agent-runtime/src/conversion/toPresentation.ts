import {
  describeIssues,
  err,
  ok,
  pickReadableColour,
  presentationSchema,
  toValidationIssues,
  type IdGenerator,
  type Koma,
  type KomaElement,
  type KomaTransition,
  type Presentation,
  type Result,
} from '@koma-motion/core';
import { buildTransition } from '@koma-motion/motion-engine';
import { agentError, type AgentError } from '../contract/errors';
import type { PresentationGenerationRequest } from '../contract/request';
import type { AgentElement, AgentKoma, AgentPresentationResponse } from '../contract/response';

export interface ConvertedPresentation {
  readonly presentation: Presentation;
  /** Sentences that can be shown to the user as they are. */
  readonly warnings: readonly string[];
}

const DEFAULT_FONT_SIZE = 40;
const DEFAULT_LINE_HEIGHT = 1.2;
const DEFAULT_CORNER_RADIUS = 24;
const DEFAULT_LINE_WIDTH = 4;

function convertElement(
  element: AgentElement,
  id: string,
  request: PresentationGenerationRequest,
  backgroundColour: string,
): KomaElement | null {
  const { colours, typography } = request.brandKit;
  const base = {
    id,
    persistentId: element.persistentId,
    name: element.name === '' ? element.persistentId : element.name,
    position: { x: element.x, y: element.y },
    size: { width: element.width, height: element.height },
    rotation: element.rotation,
    opacity: element.opacity,
    zIndex: element.zIndex,
    locked: false,
    visible: true,
  };

  switch (element.type) {
    case 'text': {
      if (element.text === null) {
        return null;
      }
      const isHeading = element.fontRole === 'heading';
      return {
        ...base,
        type: 'text',
        content: { text: element.text },
        style: {
          fontFamily: isHeading ? typography.headingFont : typography.bodyFont,
          fontSize: element.fontSize ?? DEFAULT_FONT_SIZE,
          fontWeight: element.fontWeight ?? (isHeading ? 700 : 400),
          colour:
            element.textColour?.toUpperCase() ??
            pickReadableColour(backgroundColour, [colours.text, colours.background]),
          textAlign: element.textAlign ?? 'left',
          verticalAlign: element.verticalAlign ?? 'top',
          lineHeight: DEFAULT_LINE_HEIGHT,
        },
      };
    }
    case 'shape': {
      if (element.shape === null) {
        return null;
      }
      const isLine = element.shape === 'line';
      const stroke = element.strokeColour?.toUpperCase() ?? (isLine ? colours.text : null);
      const fill = isLine
        ? null
        : (element.fillColour?.toUpperCase() ?? (stroke === null ? colours.primary : null));
      return {
        ...base,
        type: 'shape',
        content: {
          shape: element.shape,
          cornerRadius:
            element.shape === 'roundedRectangle'
              ? (element.cornerRadius ?? DEFAULT_CORNER_RADIUS)
              : 0,
        },
        style: {
          fill,
          stroke,
          strokeWidth: element.strokeWidth ?? (stroke === null ? 0 : DEFAULT_LINE_WIDTH),
        },
      };
    }
    case 'image': {
      if (element.assetId === null) {
        return null;
      }
      return {
        ...base,
        type: 'image',
        content: { assetId: element.assetId, altText: element.name },
        style: { fit: 'contain', cornerRadius: element.cornerRadius ?? 0 },
      };
    }
  }
}

function convertKoma(
  koma: AgentKoma,
  request: PresentationGenerationRequest,
  idGenerator: IdGenerator,
): Koma {
  const backgroundColour =
    koma.backgroundColour?.toUpperCase() ?? request.brandKit.colours.background;
  const elements: KomaElement[] = [];
  for (const element of koma.elements) {
    const converted = convertElement(
      element,
      idGenerator.next('element', `${koma.key}/${element.persistentId}`),
      request,
      backgroundColour,
    );
    if (converted !== null) {
      elements.push(converted);
    }
  }
  return {
    id: idGenerator.next('koma', koma.key),
    title: koma.title,
    purpose: koma.purpose,
    speakerNotes: koma.speakerNotes,
    holdDurationMs: null,
    background: { type: 'solid', colour: backgroundColour },
    elements,
  };
}

/**
 * Converts a validated agent response into the internal document model.
 *
 * Element-level operations are never taken from the agent: the motion engine
 * computes them from the Komas. The agent only suggests strategy, duration,
 * easing and a rationale, and those suggestions are normalised.
 */
export function convertResponseToPresentation(
  response: AgentPresentationResponse,
  options: {
    readonly request: PresentationGenerationRequest;
    readonly idGenerator: IdGenerator;
  },
): Result<ConvertedPresentation, AgentError> {
  const { request, idGenerator } = options;
  const warnings: string[] = [];

  const komas = response.komas.map((koma) => convertKoma(koma, request, idGenerator));

  const transitions: KomaTransition[] = [];
  for (const [index, to] of komas.entries()) {
    const from = komas[index - 1];
    const fromKey = response.komas[index - 1]?.key;
    const toKey = response.komas[index]?.key;
    if (from === undefined || fromKey === undefined || toKey === undefined) {
      continue;
    }
    const suggestion = response.transitions.find(
      (candidate) => candidate.fromKoma === fromKey && candidate.toKoma === toKey,
    );
    const built = buildTransition({
      id: idGenerator.next('transition', `${fromKey}/${toKey}`),
      from,
      to,
      ...(suggestion === undefined
        ? {}
        : {
            suggestion: {
              strategy: suggestion.strategy,
              duration: suggestion.durationMs,
              easing: suggestion.easing,
              rationale: suggestion.rationale,
            },
          }),
    });
    if (!built.ok) {
      return err(
        agentError(
          'conversionFailed',
          `The motion between "${from.title}" and "${to.title}" could not be computed:\n${built.error.map((issue) => issue.message).join('\n')}`,
        ),
      );
    }
    transitions.push(built.value.transition);
    warnings.push(...built.value.warnings.map((warning) => warning.message));
  }

  const candidate: Presentation = {
    id: idGenerator.next('presentation', 'presentation'),
    title: response.presentation.title,
    objective: response.presentation.objective,
    audience: response.presentation.audience,
    narrative: response.presentation.narrative,
    aspectRatio: request.canvas.aspectRatio,
    komas,
    transitions,
  };

  const validated = presentationSchema.safeParse(candidate);
  if (!validated.success) {
    return err(
      agentError(
        'conversionFailed',
        `The generated presentation is not valid:\n${describeIssues(toValidationIssues(validated.error))}`,
      ),
    );
  }
  return ok({ presentation: validated.data, warnings });
}
