import { agentError } from '../../contract/errors';
import type { PresentationGenerationRequest } from '../../contract/request';
import type { TransitionRegenerationRequest } from '../../contract/transition';
import type {
  AgentExecutionContext,
  AgentProvider,
  ProviderDetectionResult,
  ProviderExecutionResult,
  ProviderMetadata,
} from '../types';
import { buildMockResponse, buildMockTransitionSettings } from './mockStory';

export const MOCK_PROVIDER_ID = 'mock';
export const MOCK_PROVIDER_VERSION = '1.0.0';

const PROGRESS_STEPS = [
  'Outlining the story',
  'Composing the Komas',
  'Choosing the choreography',
] as const;
const TRANSITION_PROGRESS_STEPS = ['Comparing the two Komas', 'Choosing the choreography'] as const;

export interface MockAgentProviderOptions {
  /**
   * Time the provider pretends to work, in milliseconds. It exists so that
   * progress and cancellation can be seen in the application.
   */
  readonly delayMs?: number;
  readonly now?: () => Date;
}

/** Resolves after `durationMs`, or rejects as soon as `signal` is aborted. */
function sleep(durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, durationMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * A provider that needs no AI service, no network and no API key. It always
 * answers with the same demonstration story for the same request.
 */
export class MockAgentProvider implements AgentProvider {
  readonly id = MOCK_PROVIDER_ID;
  readonly displayName = 'Mock provider';
  readonly metadata: ProviderMetadata = {
    id: MOCK_PROVIDER_ID,
    displayName: this.displayName,
    description:
      'Built-in demonstration provider. Works offline and always creates the same three Komas.',
    kind: 'builtIn',
    usesExternalService: false,
    supportsModelSelection: false,
    defaultModel: null,
  };

  readonly #delayMs: number;
  readonly #now: () => Date;

  constructor(options: MockAgentProviderOptions = {}) {
    this.#delayMs = Math.max(0, options.delayMs ?? 1200);
    this.#now = options.now ?? (() => new Date());
  }

  detect(): Promise<ProviderDetectionResult> {
    return Promise.resolve({
      providerId: this.id,
      availability: 'available',
      version: MOCK_PROVIDER_VERSION,
      message: 'Built in. Always available.',
      checkedAt: this.#now().toISOString(),
    });
  }

  async generatePresentation(
    request: PresentationGenerationRequest,
    context: AgentExecutionContext,
  ): Promise<ProviderExecutionResult> {
    return this.#answer(PROGRESS_STEPS, context, () => buildMockResponse(request));
  }

  async generateTransition(
    request: TransitionRegenerationRequest,
    context: AgentExecutionContext,
  ): Promise<ProviderExecutionResult> {
    return this.#answer(TRANSITION_PROGRESS_STEPS, context, () =>
      buildMockTransitionSettings(request),
    );
  }

  async #answer(
    steps: readonly string[],
    context: AgentExecutionContext,
    build: () => unknown,
  ): Promise<ProviderExecutionResult> {
    const details = { exitCode: null, errorOutput: '' };
    try {
      for (const step of steps) {
        context.reportProgress(step);
        await sleep(this.#delayMs / steps.length, context.signal);
      }
    } catch {
      return {
        ok: false,
        error: agentError('cancelled', 'The generation was stopped.'),
        details,
      };
    }
    return {
      ok: true,
      output: { rawText: JSON.stringify(build()) },
      details,
    };
  }
}
