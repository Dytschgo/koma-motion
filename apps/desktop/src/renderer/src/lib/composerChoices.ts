/**
 * Choices in the chat composer: the model of the selected provider and the
 * number of Komas. Pure functions, so that the rules can be tested without a
 * window. The model belongs to the project (`agentConfiguration`); the Koma
 * count is part of one request and is not saved.
 */
import type { ProviderMetadata } from '@koma-motion/agent-runtime';
import type { AgentConfiguration } from '@koma-motion/core';

/** The number of Komas the composer offers first. */
export const DEFAULT_KOMA_COUNT = 5;

/** Value of the model option that leaves the choice to the provider. */
export const DEFAULT_MODEL_VALUE = '';

export interface ModelOption {
  /** A model id, or {@link DEFAULT_MODEL_VALUE}. */
  readonly value: string;
  readonly label: string;
}

export interface ModelChoices {
  readonly options: readonly ModelOption[];
  readonly value: string;
  /** False when the provider always uses its own model. */
  readonly selectable: boolean;
}

/**
 * The models the composer offers for a provider. No provider can list its
 * models, so the choices are the provider default and the model id that is
 * configured for it. `remembered` keeps a model id that was configured
 * earlier in the session, so choosing Default does not make it unreachable.
 */
export function getModelChoices(
  metadata: ProviderMetadata | undefined,
  configuration: AgentConfiguration,
  remembered: string | null = null,
): ModelChoices {
  const defaultModel = metadata?.defaultModel ?? null;
  const defaultLabel = defaultModel === null ? 'Default' : `Default (${defaultModel})`;
  const defaultOption: ModelOption = { value: DEFAULT_MODEL_VALUE, label: defaultLabel };
  if (metadata === undefined || !metadata.supportsModelSelection) {
    return { options: [defaultOption], value: DEFAULT_MODEL_VALUE, selectable: false };
  }
  const configured = configuration.providers[metadata.id]?.model ?? null;
  const ids = [configured, remembered].filter(
    (id, index, all): id is string =>
      id !== null && id !== defaultModel && all.indexOf(id) === index,
  );
  return {
    options: [defaultOption, ...ids.map((id) => ({ value: id, label: id }))],
    value: configured === null || configured === defaultModel ? DEFAULT_MODEL_VALUE : configured,
    selectable: true,
  };
}

/** Sets the model of one provider. {@link DEFAULT_MODEL_VALUE} stores `null`. */
export function withProviderModel(
  configuration: AgentConfiguration,
  providerId: string,
  value: string,
): AgentConfiguration {
  return {
    ...configuration,
    providers: {
      ...configuration.providers,
      [providerId]: { model: value === DEFAULT_MODEL_VALUE ? null : value },
    },
  };
}

/**
 * Reads the Koma count field. `null` asks the agent to choose a suitable
 * number (Auto). Text that is not a positive whole number is `undefined`.
 */
export function parseKomaCount(auto: boolean, text: string): number | null | undefined {
  if (auto) {
    return null;
  }
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const count = Number(trimmed);
  return Number.isSafeInteger(count) && count > 0 ? count : undefined;
}
