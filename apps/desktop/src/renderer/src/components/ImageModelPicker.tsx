import type { KomaProject } from '@koma-motion/core';
import type { ReactElement } from 'react';
import { useAgentStore } from '../state/agentStore';
import { changeAgentConfiguration } from '../state/commands';
import { useProjectStore } from '../state/projectStore';
import { CheckIcon } from './icons';
import { ProviderLogo } from './ProviderLogo';

export function ImageModelPicker({
  project,
  disabled,
}: {
  readonly project: KomaProject;
  readonly disabled: boolean;
}): ReactElement {
  const providers = useAgentStore((state) => state.providers);
  const apply = useProjectStore((state) => state.apply);
  const selected = project.agentConfiguration.imageGeneration ?? 'off';
  return (
    <div className="overflow-y-auto p-2" role="group" aria-label="Image generation choices">
      {(['off', 'codex', 'grok'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={selected === value}
          disabled={disabled}
          className={`flex w-full items-center gap-3 rounded-control px-3 py-3 text-left disabled:opacity-50 ${selected === value ? 'bg-accent-deep' : 'hover:bg-surface-3'}`}
          onClick={() =>
            apply(
              changeAgentConfiguration({ ...project.agentConfiguration, imageGeneration: value }),
            )
          }
        >
          <span className="flex size-7 flex-none items-center justify-center rounded-control border border-line">
            {value !== 'off' ? (
              <ProviderLogo providerId={value} />
            ) : (
              <span aria-hidden="true">—</span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block text-sm text-ink-100">
              {value === 'off' ? 'Off' : value === 'codex' ? 'Codex' : 'Grok Imagine'}
            </strong>
            <span className="mt-1 block text-xs text-ink-300">
              {value === 'off'
                ? 'Existing images only'
                : providers.some(
                      (provider) =>
                        provider.metadata.id === value &&
                        provider.detection.availability === 'available',
                    )
                  ? 'CLI-managed model'
                  : `Install ${value === 'codex' ? 'Codex' : 'Grok'} CLI`}
            </span>
          </span>
          {selected === value && (
            <span className="text-accent">
              <CheckIcon size={14} />
            </span>
          )}
        </button>
      ))}
      <p className="px-2 pt-3 pb-2 text-xs leading-relaxed text-ink-400">
        Uses your existing CLI sign-in.
      </p>
    </div>
  );
}
