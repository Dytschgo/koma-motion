import {
  EASINGS,
  err,
  formatPath,
  ok,
  TRANSITION_STRATEGIES,
  type Result,
} from '@koma-motion/core';
import {
  agentError,
  describeResponseIssues,
  type AgentError,
  type ResponseIssue,
} from '../contract/errors';
import { AGENT_ELEMENT_TYPES, type PresentationGenerationRequest } from '../contract/request';
import {
  agentPresentationResponseSchema,
  type AgentElement,
  type AgentPresentationResponse,
} from '../contract/response';

export interface ValidatedResponse {
  readonly response: AgentPresentationResponse;
  /** Sentences that can be shown to the user as they are. */
  readonly warnings: readonly string[];
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : null;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function includes(list: readonly string[], value: unknown): boolean {
  return typeof value === 'string' && list.includes(value);
}

/**
 * Finds element types and transition settings that Koma Motion does not
 * support, so they can be reported by name instead of as schema errors.
 */
function findUnsupportedValues(output: unknown): ResponseIssue[] {
  const issues: ResponseIssue[] = [];
  const root = asRecord(output);

  asArray(root?.['komas']).forEach((koma, komaIndex) => {
    asArray(asRecord(koma)?.['elements']).forEach((element, elementIndex) => {
      const type = asRecord(element)?.['type'];
      if (typeof type === 'string' && !includes(AGENT_ELEMENT_TYPES, type)) {
        issues.push({
          code: 'unsupportedElementType',
          path: `komas[${String(komaIndex)}].elements[${String(elementIndex)}].type`,
          message: `The element type "${type}" is not supported. Supported types: ${AGENT_ELEMENT_TYPES.join(', ')}.`,
        });
      }
    });
  });

  asArray(root?.['transitions']).forEach((transition, index) => {
    const record = asRecord(transition);
    const strategy = record?.['strategy'];
    if (typeof strategy === 'string' && !includes(TRANSITION_STRATEGIES, strategy)) {
      issues.push({
        code: 'unsupportedTransition',
        path: `transitions[${String(index)}].strategy`,
        message: `The transition strategy "${strategy}" is not supported. Supported strategies: ${TRANSITION_STRATEGIES.join(', ')}.`,
      });
    }
    const easing = record?.['easing'];
    if (typeof easing === 'string' && !includes(EASINGS, easing)) {
      issues.push({
        code: 'unsupportedTransition',
        path: `transitions[${String(index)}].easing`,
        message: `The easing "${easing}" is not supported. Supported easings: ${EASINGS.join(', ')}.`,
      });
    }
  });

  return issues;
}

function checkElementContent(
  element: AgentElement,
  path: string,
  request: PresentationGenerationRequest,
): ResponseIssue[] {
  const issues: ResponseIssue[] = [];
  if (!request.allowedElementTypes.includes(element.type)) {
    issues.push({
      code: 'unsupportedElementType',
      path: `${path}.type`,
      message: `The element type "${element.type}" is not allowed in this request. Allowed types: ${request.allowedElementTypes.join(', ')}.`,
    });
    return issues;
  }
  switch (element.type) {
    case 'text':
      if (element.text === null) {
        issues.push({
          code: 'missingContent',
          path: `${path}.text`,
          message: 'A text element needs "text".',
        });
      } else if (element.text.length > request.constraints.maxTextLength) {
        issues.push({
          code: 'limitExceeded',
          path: `${path}.text`,
          message: `The text has ${String(element.text.length)} characters. The limit is ${String(request.constraints.maxTextLength)}.`,
        });
      }
      break;
    case 'shape':
      if (element.shape === null) {
        issues.push({
          code: 'missingContent',
          path: `${path}.shape`,
          message: 'A shape element needs "shape".',
        });
      }
      break;
    case 'image':
      if (element.assetId === null) {
        issues.push({
          code: 'missingContent',
          path: `${path}.assetId`,
          message: 'An image element needs "assetId".',
        });
      } else if (!request.availableAssets.some((asset) => asset.id === element.assetId)) {
        issues.push({
          code: 'invalidReference',
          path: `${path}.assetId`,
          message: `The asset "${element.assetId}" does not exist in the project. Images may only use the assets listed in the request.`,
        });
      }
      break;
  }
  return issues;
}

function checkSemantics(
  response: AgentPresentationResponse,
  request: PresentationGenerationRequest,
): ResponseIssue[] {
  const issues: ResponseIssue[] = [];
  const { constraints } = request;

  if (constraints.maxKomas !== null && response.komas.length > constraints.maxKomas) {
    issues.push({
      code: 'limitExceeded',
      path: 'komas',
      message: `The response contains ${String(response.komas.length)} Komas. The limit is ${String(constraints.maxKomas)}.`,
    });
  }

  const komaIndexByKey = new Map<string, number>();
  response.komas.forEach((koma, komaIndex) => {
    const komaPath = `komas[${String(komaIndex)}]`;
    if (komaIndexByKey.has(koma.key)) {
      issues.push({
        code: 'duplicateId',
        path: `${komaPath}.key`,
        message: `The Koma key "${koma.key}" is used more than once.`,
      });
    } else {
      komaIndexByKey.set(koma.key, komaIndex);
    }

    if (koma.elements.length > constraints.maxElementsPerKoma) {
      issues.push({
        code: 'limitExceeded',
        path: `${komaPath}.elements`,
        message: `The Koma contains ${String(koma.elements.length)} elements. The limit is ${String(constraints.maxElementsPerKoma)}.`,
      });
    }

    const persistentIds = new Set<string>();
    koma.elements.forEach((element, elementIndex) => {
      const elementPath = `${komaPath}.elements[${String(elementIndex)}]`;
      if (persistentIds.has(element.persistentId)) {
        issues.push({
          code: 'duplicateId',
          path: `${elementPath}.persistentId`,
          message: `The persistent id "${element.persistentId}" is used more than once in this Koma. Within one Koma every object needs its own persistent id.`,
        });
      }
      persistentIds.add(element.persistentId);
      issues.push(...checkElementContent(element, elementPath, request));
    });
  });

  const pairs = new Set<string>();
  response.transitions.forEach((transition, index) => {
    const path = `transitions[${String(index)}]`;
    const fromIndex = komaIndexByKey.get(transition.fromKoma);
    const toIndex = komaIndexByKey.get(transition.toKoma);
    if (fromIndex === undefined) {
      issues.push({
        code: 'invalidReference',
        path: `${path}.fromKoma`,
        message: `The transition starts at Koma "${transition.fromKoma}", which does not exist.`,
      });
    }
    if (toIndex === undefined) {
      issues.push({
        code: 'invalidReference',
        path: `${path}.toKoma`,
        message: `The transition ends at Koma "${transition.toKoma}", which does not exist.`,
      });
    }
    if (fromIndex !== undefined && toIndex !== undefined && toIndex !== fromIndex + 1) {
      issues.push({
        code: 'invalidReference',
        path,
        message: `Transitions must connect a Koma with the Koma that follows it. "${transition.fromKoma}" and "${transition.toKoma}" do not follow one another.`,
      });
    }
    const pair = `${transition.fromKoma}/${transition.toKoma}`;
    if (pairs.has(pair)) {
      issues.push({
        code: 'duplicateId',
        path,
        message: `There is more than one transition from "${transition.fromKoma}" to "${transition.toKoma}".`,
      });
    }
    pairs.add(pair);
  });

  return issues;
}

/**
 * Validates untrusted structured output against the response contract and
 * the request it answers. Nothing is accepted that was not checked here.
 */
export function validateAgentResponse(
  output: unknown,
  request: PresentationGenerationRequest,
): Result<ValidatedResponse, AgentError> {
  const fail = (issues: readonly ResponseIssue[]): Result<ValidatedResponse, AgentError> =>
    err(
      agentError(
        'invalidResponse',
        `The response of the agent does not follow the required structure:\n${describeResponseIssues(issues)}`,
        issues,
      ),
    );

  const unsupported = findUnsupportedValues(output);
  if (unsupported.length > 0) {
    return fail(unsupported);
  }

  const parsed = agentPresentationResponseSchema.safeParse(output);
  if (!parsed.success) {
    return fail(
      parsed.error.issues.map((issue) => ({
        code: 'schema',
        path: formatPath(issue.path),
        message: issue.message,
      })),
    );
  }

  const issues = checkSemantics(parsed.data, request);
  const imageIds = new Set<string>();
  for (const image of parsed.data.imageRequests ?? []) {
    const targets = parsed.data.komas
      .flatMap((koma) => koma.elements)
      .filter((element) => element.persistentId === image.persistentId);
    if (
      !request.imageGenerationEnabled ||
      imageIds.has(image.persistentId) ||
      !targets.length ||
      targets.some((element) => element.type !== 'shape')
    ) {
      issues.push({
        code: 'invalidReference',
        path: 'imageRequests',
        message:
          'Image requests require enabled image generation and a unique persistentId used only by shape placeholders.',
      });
    }
    imageIds.add(image.persistentId);
  }
  if (issues.length > 0) {
    return fail(issues);
  }

  const warnings = [...parsed.data.warnings];
  if (
    request.requestedKomaCount !== null &&
    parsed.data.komas.length !== request.requestedKomaCount
  ) {
    warnings.push(
      `${String(request.requestedKomaCount)} Komas were requested, the agent created ${String(parsed.data.komas.length)}.`,
    );
  }
  return ok({ response: parsed.data, warnings });
}
