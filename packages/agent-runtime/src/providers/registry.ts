import type { AgentProvider, ProviderDetectionResult, ProviderMetadata } from './types';

export interface DetectedProvider {
  readonly metadata: ProviderMetadata;
  readonly detection: ProviderDetectionResult;
}

/** The providers known to the application, in the order they were registered. */
export class ProviderRegistry {
  readonly #providers = new Map<string, AgentProvider>();

  constructor(providers: readonly AgentProvider[] = []) {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  register(provider: AgentProvider): void {
    if (this.#providers.has(provider.id)) {
      throw new Error(`A provider with the id "${provider.id}" is already registered`);
    }
    if (provider.id !== provider.metadata.id) {
      throw new Error(`The metadata of provider "${provider.id}" uses a different id`);
    }
    this.#providers.set(provider.id, provider);
  }

  get(providerId: string): AgentProvider | undefined {
    return this.#providers.get(providerId);
  }

  list(): AgentProvider[] {
    return [...this.#providers.values()];
  }

  /**
   * Detects every provider. A provider whose detection throws is reported as
   * an error and does not affect the other providers.
   */
  async detectAll(now: () => Date = () => new Date()): Promise<DetectedProvider[]> {
    return Promise.all(
      this.list().map(async (provider): Promise<DetectedProvider> => {
        try {
          return { metadata: provider.metadata, detection: await provider.detect() };
        } catch {
          return {
            metadata: provider.metadata,
            detection: {
              providerId: provider.id,
              availability: 'error',
              version: null,
              message: `${provider.displayName} could not be checked.`,
              checkedAt: now().toISOString(),
            },
          };
        }
      }),
    );
  }
}
