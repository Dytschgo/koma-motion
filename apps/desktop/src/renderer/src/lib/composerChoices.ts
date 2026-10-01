/**
 * Choices in the chat composer: the model of the selected provider and the
 * number of Komas. Pure functions, so that the rules can be tested without a
 * window. The model belongs to the project (`agentConfiguration`); the Koma
 * count is part of one request and is not saved.
 */
import type { ProviderMetadata, ProviderModelListing } from '@koma-motion/agent-runtime';
import { modelNameSchema, type AgentConfiguration } from '@koma-motion/core';

/** The number of Komas the composer offers first. */
export const DEFAULT_KOMA_COUNT = 5;

/** Value of the model option that leaves the choice to the provider. */
export const DEFAULT_MODEL_VALUE = '';

/**
 * Value of the option that opens the field for a model id. A model name
 * starts with a letter or digit, so no model can have this value.
 */
export const CUSTOM_MODEL_VALUE = '__custom__';

export type ModelOptionGroup = 'default' | 'aliases' | 'ids' | 'account' | 'custom' | 'enter';

export interface ModelOption {
  /** A model id, {@link DEFAULT_MODEL_VALUE} or {@link CUSTOM_MODEL_VALUE}. */
  readonly value: string;
  readonly label: string;
  readonly group: ModelOptionGroup;
}

/** Headings of the option groups in the model list. */
export const MODEL_GROUP_LABELS: Readonly<Record<ModelOptionGroup, string>> = {
  default: 'Default',
  aliases: 'Aliases',
  ids: 'Model names',
  account: 'Your account',
  custom: 'Entered model ids',
  enter: 'Other',
};

export interface ModelChoices {
  readonly options: readonly ModelOption[];
  /** The selected option. */
  readonly value: string;
  /** False when the provider always uses its own model. */
  readonly selectable: boolean;
  /** Whether a model id can be typed. */
  readonly acceptsCustom: boolean;
  /** The model the next run uses: `null` leaves the choice to the provider. */
  readonly effectiveModel: string | null;
  /** The next run's model in words, for example "opus" or "the default model of Grok". */
  readonly effectiveLabel: string;
  /**
   * `notListed` when the provider listed the models of the account and the
   * chosen model is not among them. `unknown` when no list was read.
   */
  readonly availability: 'unknown' | 'listed' | 'notListed';
  /** Where the list comes from, in a sentence. */
  readonly note: string;
}

/**
 * The models the composer offers for a provider: Default, the provider's
 * catalog, the models its CLI listed for the account, and model ids that
 * were configured or entered earlier. `remembered` keeps a model id that was
 * configured earlier in the session, so choosing Default does not make it
 * unreachable.
 */
export function getModelChoices(
  metadata: ProviderMetadata | undefined,
  configuration: AgentConfiguration,
  options: {
    readonly remembered?: string | null;
    readonly listing?: ProviderModelListing | null;
  } = {},
): ModelChoices {
  const listing = options.listing?.status === 'listed' ? options.listing : null;
  const defaultModel = listing?.defaultModel ?? metadata?.defaultModel ?? null;
  const defaultOption: ModelOption = {
    value: DEFAULT_MODEL_VALUE,
    label: defaultModel === null ? 'Default' : `Default (${defaultModel})`,
    group: 'default',
  };
  const name = metadata?.displayName ?? 'the provider';
  if (metadata === undefined || !metadata.supportsModelSelection) {
    return {
      options: [defaultOption],
      value: DEFAULT_MODEL_VALUE,
      selectable: false,
      acceptsCustom: false,
      effectiveModel: null,
      effectiveLabel: `the model of ${name}`,
      availability: 'unknown',
      note: metadata?.modelCatalog.note ?? '',
    };
  }

  const seen = new Set<string>([DEFAULT_MODEL_VALUE]);
  const list: ModelOption[] = [defaultOption];
  const add = (value: string, label: string, group: ModelOptionGroup): void => {
    if (seen.has(value)) return;
    seen.add(value);
    list.push({ value, label, group });
  };
  for (const model of metadata.modelCatalog.models) {
    add(
      model.id,
      model.label === model.id ? model.id : `${model.label} · ${model.id}`,
      model.kind === 'alias' ? 'aliases' : 'ids',
    );
  }
  for (const id of listing?.models ?? []) {
    add(id, id === listing?.defaultModel ? `${id} (account default)` : id, 'account');
  }

  const configured = configuration.providers[metadata.id]?.model ?? null;
  for (const id of [configured, options.remembered ?? null]) {
    if (id !== null) add(id, id, 'custom');
  }
  if (metadata.acceptsCustomModel) {
    list.push({ value: CUSTOM_MODEL_VALUE, label: 'Enter a model id…', group: 'enter' });
  }

  const value = configured ?? DEFAULT_MODEL_VALUE;
  const effectiveModel = value === DEFAULT_MODEL_VALUE ? null : value;
  return {
    options: list,
    value,
    selectable: true,
    acceptsCustom: metadata.acceptsCustomModel,
    effectiveModel,
    effectiveLabel:
      effectiveModel ??
      (defaultModel === null ? `the default model of ${name}` : `${defaultModel} (default)`),
    availability:
      listing === null
        ? 'unknown'
        : effectiveModel === null || listing.models.includes(effectiveModel)
          ? 'listed'
          : 'notListed',
    note: metadata.modelCatalog.note,
  };
}

/** Checks a typed model id. Surrounding spaces are removed. */
export function parseCustomModel(
  text: string,
):
  { readonly ok: true; readonly model: string } | { readonly ok: false; readonly message: string } {
  const model = text.trim();
  if (model === '') {
    return { ok: false, message: 'Enter a model id.' };
  }
  if (!modelNameSchema.safeParse(model).success) {
    return {
      ok: false,
      message:
        'Use up to 80 letters, digits and . _ : - [ ], starting with a letter or digit, without spaces.',
    };
  }
  return { ok: true, model };
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
