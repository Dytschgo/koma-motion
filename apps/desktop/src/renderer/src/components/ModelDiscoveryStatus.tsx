import type { ReactElement } from 'react';
import { listProviderModels } from '../lib/agentActions';
import { useAgentStore, type DetectedProvider } from '../state/agentStore';
import { RefreshIcon } from './icons';

export function ModelDiscoveryStatus({
  provider,
  disabled,
}: {
  readonly provider: DetectedProvider;
  readonly disabled: boolean;
}): ReactElement | null {
  const listing = useAgentStore((state) => state.modelListings[provider.metadata.id]);
  if (!provider.metadata.supportsModelSelection) return null;
  const loading = listing === 'loading';
  const name = provider.metadata.displayName;
  const message = loading
    ? 'Discovering models…'
    : listing?.status === 'listed'
      ? `${listing.models.length} models · checked ${new Date(listing.checkedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
      : listing?.status === 'failed'
        ? listing.message
        : listing?.status === 'unsupported' || provider.metadata.modelCatalog.source !== 'cli'
          ? 'Capability discovery unsupported. Use the CLI default or a custom ID.'
          : 'Models have not been checked. The CLI default is available.';
  return (
    <div className="flex items-center gap-2 text-xs" data-discovery-provider={provider.metadata.id}>
      <p
        role={listing !== 'loading' && listing?.status === 'failed' ? 'alert' : 'status'}
        className="min-w-0 flex-1 text-ink-300"
      >
        <span className="font-medium">{name}</span> · {message}
      </p>
      {provider.metadata.modelCatalog.source === 'cli' && (
        <button
          type="button"
          disabled={disabled || loading}
          aria-label={`${listing !== 'loading' && listing?.status === 'failed' ? 'Retry' : 'Refresh'} models from ${name}`}
          title="Refresh model and reasoning capabilities"
          className="flex size-8 flex-none items-center justify-center rounded-control text-ink-300 hover:bg-surface-3 hover:text-accent disabled:opacity-40"
          onClick={() => void listProviderModels(provider.metadata.id)}
        >
          <RefreshIcon size={14} />
        </button>
      )}
    </div>
  );
}
