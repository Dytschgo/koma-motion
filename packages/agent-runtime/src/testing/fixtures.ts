import { buildProject } from '@koma-motion/core/testing';
import { agentError } from '../contract/errors';
import { buildGenerationRequest, type PresentationGenerationRequest } from '../contract/request';
import type { AgentPresentationResponse } from '../contract/response';
import { buildMockResponse } from '../providers/mock/mockStory';
import type {
  AgentExecutionContext,
  AgentProvider,
  ProviderDetectionResult,
  ProviderExecutionResult,
} from '../providers/types';

export function buildRequest(
  overrides: Partial<PresentationGenerationRequest> = {},
): PresentationGenerationRequest {
  return {
    ...buildGenerationRequest(buildProject({ presentation: emptyPresentation() }), {
      userRequest: 'Create a three-frame presentation introducing Koma Motion.',
      objective: null,
      audience: null,
      requestedKomaCount: 3,
    }),
    ...overrides,
  };
}

function emptyPresentation(): ReturnType<typeof buildProject>['presentation'] {
  return { ...buildProject().presentation, komas: [], transitions: [] };
}

export function buildResponse(): AgentPresentationResponse {
  return buildMockResponse(buildRequest());
}

export type ScriptedAnswer =
  | string
  | { readonly structured: unknown; readonly rawText?: string }
  | { readonly fail: Parameters<typeof agentError> }
  | { readonly throwError: string }
  | { readonly waitForAbort: true };

/** A provider that answers with prepared output, one entry per attempt. */
export class ScriptedProvider implements AgentProvider {
  readonly id: string;
  readonly displayName = 'Scripted provider';
  readonly metadata;
  readonly contexts: AgentExecutionContext[] = [];
  detection: ProviderDetectionResult;

  readonly #answers: ScriptedAnswer[];

  constructor(answers: readonly ScriptedAnswer[], id = 'scripted') {
    this.id = id;
    this.#answers = [...answers];
    this.metadata = {
      id,
      displayName: this.displayName,
      description: 'Used in tests.',
      kind: 'builtIn' as const,
      usesExternalService: false,
      supportsModelSelection: false,
      defaultModel: null,
    };
    this.detection = {
      providerId: id,
      availability: 'available',
      version: '1.0.0',
      message: 'Available.',
      checkedAt: '2026-01-15T10:30:00.000Z',
    };
  }

  detect(): Promise<ProviderDetectionResult> {
    return Promise.resolve(this.detection);
  }

  generatePresentation(
    _request: PresentationGenerationRequest,
    context: AgentExecutionContext,
  ): Promise<ProviderExecutionResult> {
    this.contexts.push(context);
    const details = { exitCode: 0, errorOutput: '' };
    const answer = this.#answers.shift();
    if (answer === undefined) {
      return Promise.reject(new Error('No scripted answer left'));
    }
    if (typeof answer === 'string') {
      return Promise.resolve({ ok: true, output: { rawText: answer }, details });
    }
    if ('structured' in answer) {
      return Promise.resolve({
        ok: true,
        output: {
          rawText: answer.rawText ?? JSON.stringify(answer.structured),
          structured: answer.structured,
        },
        details,
      });
    }
    if ('fail' in answer) {
      return Promise.resolve({ ok: false, error: agentError(...answer.fail), details });
    }
    if ('throwError' in answer) {
      return Promise.reject(new Error(answer.throwError));
    }
    return new Promise((resolve) => {
      context.signal.addEventListener(
        'abort',
        () => {
          resolve({
            ok: false,
            error: agentError('cancelled', 'Stopped.'),
            details: { exitCode: null, errorOutput: '' },
          });
        },
        { once: true },
      );
    });
  }
}
