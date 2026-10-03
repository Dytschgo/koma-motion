import type {
  ProviderDetectionResult,
  ProviderMetadata,
  ProviderModelListing,
} from '@koma-motion/agent-runtime';
import type { KomaProject } from '@koma-motion/core';
import { CUSTOM_MODEL_VALUE, getModelChoices } from './composerChoices';

/** Shared row derivation: saved/favorite IDs remain reachable without claiming discovery. */
export function getModelEntries(
  providers: readonly { metadata: ProviderMetadata; detection: ProviderDetectionResult }[],
  project: KomaProject,
  listings: Readonly<Record<string, ProviderModelListing | 'loading'>>,
  remembered: Readonly<Record<string, string>>,
  favorites: readonly { providerId: string; model: string }[],
) {
  return providers
    .flatMap((provider) => {
      const id = provider.metadata.id;
      const listing = listings[id];
      const choices = getModelChoices(provider.metadata, project.agentConfiguration, {
        listing: listing === 'loading' ? null : listing,
        remembered: remembered[`${project.id}:${id}`],
      });
      const options = choices.options.filter((option) => option.value !== CUSTOM_MODEL_VALUE);
      for (const favorite of favorites) {
        if (
          favorite.providerId === id &&
          !options.some((option) => option.value === favorite.model)
        )
          options.push({ value: favorite.model, label: favorite.model, group: 'custom' });
      }
      return options.map((option) => {
        const capability =
          listing !== 'loading' && listing?.status === 'listed'
            ? listing.models.find((model) => model.id === option.value)
            : undefined;
        const hasReasoning = capability?.reasoning.status === 'supported';
        const notice =
          option.value === ''
            ? id === 'mock'
              ? null
              : 'Uses the CLI default. Choose a reported model to set reasoning.'
            : capability
              ? hasReasoning
                ? null
                : 'This CLI reports no selectable reasoning choices for this model.'
              : listing === 'loading'
                ? 'Checking model capabilities…'
                : listing?.status === 'listed'
                  ? 'This saved or custom ID is not in the latest CLI list. Availability and reasoning are unverified.'
                  : 'Custom or saved model ID. Capabilities have not been confirmed.';
        return {
          provider,
          option,
          hasReasoning,
          notice,
          title:
            option.value === ''
              ? `${provider.metadata.displayName} ${id === 'mock' ? 'demo' : 'default'}`
              : (option.label.split(' · ')[0] ?? option.label),
          favorite: favorites.some(
            (favorite) => favorite.providerId === id && favorite.model === option.value,
          ),
          selected:
            project.agentConfiguration.selectedProviderId === id && choices.value === option.value,
          available: provider.detection.availability === 'available',
        };
      });
    })
    .sort((a, b) => Number(a.option.value === '') - Number(b.option.value === ''));
}
