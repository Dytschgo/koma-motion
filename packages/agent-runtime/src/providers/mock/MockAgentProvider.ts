import { agentError } from '../../contract/errors';
import { createDefaultBrandKit } from '@koma-motion/brand-kit';
import type {
  BrandKitAnalysisContext,
  BrandKitAnalysisRequest,
  BrandKitAnalysisResponse,
} from '../../contract/brandKitAnalysis';
import type { PresentationGenerationRequest } from '../../contract/request';
import type {
  AgentExecutionContext,
  AgentProvider,
  ProviderDetectionResult,
  ProviderExecutionResult,
  ProviderMetadata,
} from '../types';
import { buildMockResponse } from './mockStory';

export const MOCK_PROVIDER_ID = 'mock';
export const MOCK_PROVIDER_VERSION = '1.0.0';

const PROGRESS_STEPS = [
  'Outlining the story',
  'Composing the Komas',
  'Choosing the choreography',
] as const;

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
  async analyzeBrandKit(
    request: BrandKitAnalysisRequest,
    context: BrandKitAnalysisContext,
  ): Promise<BrandKitAnalysisResponse> {
    await sleep(this.#delayMs, context.signal);
    context.signal.throwIfAborted();
    return {
      brandKit: {
        ...createDefaultBrandKit(),
        name: 'Mock deck brand',
        logoAssetId: null,
        referenceNotes:
          'Demonstration proposal only. Colours and fonts are safe defaults, not inferred from the deck.',
      },
      logoCandidateId: request.logoCandidates[0]?.id ?? null,
      evidence: [
        {
          field: 'visualStyle',
          confidence: 'low',
          slides: [request.slides[0]?.number ?? 1],
          observation: 'Mock analysis fixture; no visual inference was performed.',
        },
      ],
      warnings: ['Mock provider: this is a local demonstration, not visual analysis.'],
    };
  }
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
    const details = { exitCode: null, errorOutput: '' };
    try {
      for (const step of PROGRESS_STEPS) {
        context.reportProgress(step);
        await sleep(this.#delayMs / PROGRESS_STEPS.length, context.signal);
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
      output: { rawText: JSON.stringify(buildMockResponse(request)) },
      details,
    };
  }
}
