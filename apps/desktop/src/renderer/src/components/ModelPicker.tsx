import type { KomaProject } from '@koma-motion/core';
import { useId, useState, type ReactElement } from 'react';
import { listProviderModels } from '../lib/agentActions';
import {
  CUSTOM_MODEL_VALUE,
  DEFAULT_MODEL_VALUE,
  getModelChoices,
  MODEL_GROUP_LABELS,
  parseCustomModel,
  withProviderModel,
  type ModelChoices,
  type ModelOption,
} from '../lib/composerChoices';
import { useAgentStore, type DetectedProvider } from '../state/agentStore';
import { changeAgentConfiguration } from '../state/commands';
import { useProjectStore } from '../state/projectStore';
import { RefreshIcon, WarningIcon } from './icons';
import { Button, Select, TextInput } from './ui';

/** The model choices of the selected provider, with the listing and the remembered model. */
export function useModelChoices(
  project: KomaProject,
  provider: DetectedProvider | undefined,
): ModelChoices {
  const providerId = provider?.metadata.id ?? project.agentConfiguration.selectedProviderId;
  const listing = useAgentStore((state) => state.modelListings[providerId]);
  const remembered = useAgentStore(
    (state) => state.rememberedModels[`${project.id}:${providerId}`] ?? null,
  );
  return getModelChoices(provider?.metadata, project.agentConfiguration, {
    remembered,
    listing: listing === 'loading' ? null : (listing ?? null),
  });
}

function groupOptions(options: readonly ModelOption[]): [string, ModelOption[]][] {
  const groups = new Map<string, ModelOption[]>();
  for (const option of options) {
    const label = MODEL_GROUP_LABELS[option.group];
    groups.set(label, [...(groups.get(label) ?? []), option]);
  }
  return [...groups.entries()];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Chooses the model of one provider for the open project: the provider's
 * default, a model from its catalog or account list, or a typed model id.
 * The choice is a project change and can be undone.
 */
export function ModelPicker({
  project,
  provider,
  label,
  disabled = false,
}: {
  readonly project: KomaProject;
  readonly provider: DetectedProvider | undefined;
  readonly label: string;
  readonly disabled?: boolean;
}): ReactElement {
  const apply = useProjectStore((state) => state.apply);
  const rememberModel = useAgentStore((state) => state.rememberModel);
  const providerId = provider?.metadata.id ?? project.agentConfiguration.selectedProviderId;
  const listing = useAgentStore((state) => state.modelListings[providerId]);
  const choices = useModelChoices(project, provider);
  const [custom, setCustom] = useState<string | null>(null);
  const selectId = useId();
  const customId = useId();
  const errorId = useId();
  const noteId = useId();
  const parsed = custom === null ? null : parseCustomModel(custom);
  const name = provider?.metadata.displayName ?? providerId;

  const choose = (value: string): void => {
    if (value === DEFAULT_MODEL_VALUE && choices.value !== DEFAULT_MODEL_VALUE) {
      rememberModel(`${project.id}:${providerId}`, choices.value);
    }
    apply(
      changeAgentConfiguration(withProviderModel(project.agentConfiguration, providerId, value)),
    );
  };

  const applyCustom = (): void => {
    if (parsed?.ok !== true) return;
    choose(parsed.model);
    setCustom(null);
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={selectId} className="text-sm font-medium text-ink-300">
        {label}
      </label>
      <Select
        id={selectId}
        value={custom === null ? choices.value : CUSTOM_MODEL_VALUE}
        disabled={disabled || !choices.selectable}
        aria-describedby={noteId}
        title={choices.selectable ? undefined : `${name} has no model choice.`}
        onChange={(event) => {
          const value = event.target.value;
          if (value === CUSTOM_MODEL_VALUE) {
            setCustom(choices.effectiveModel ?? '');
            return;
          }
          setCustom(null);
          choose(value);
        }}
      >
        {groupOptions(choices.options).map(([group, options]) =>
          options.length === 1 &&
          (options[0]?.group === 'default' || options[0]?.group === 'enter') ? (
            <option key={group} value={options[0].value}>
              {options[0].label}
            </option>
          ) : (
            <optgroup key={group} label={group}>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ),
        )}
      </Select>

      {custom !== null && (
        <div className="flex flex-col gap-1">
          <label htmlFor={customId} className="text-sm font-medium text-ink-300">
            Model id
          </label>
          <div className="flex gap-2">
            <TextInput
              id={customId}
              autoFocus
              spellCheck={false}
              value={custom}
              placeholder="For example claude-opus-5-5"
              aria-invalid={custom !== '' && parsed?.ok === false ? true : undefined}
              aria-describedby={custom !== '' && parsed?.ok === false ? errorId : undefined}
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applyCustom();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setCustom(null);
                }
              }}
            />
            <Button variant="outline" compact disabled={parsed?.ok !== true} onClick={applyCustom}>
              Use
            </Button>
          </div>
          {custom !== '' && parsed?.ok === false && (
            <p id={errorId} role="alert" className="text-sm text-motion">
              Error: {parsed.message}
            </p>
          )}
        </div>
      )}

      {provider?.metadata.modelCatalog.source === 'cli' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            compact
            icon={<RefreshIcon size={14} />}
            disabled={disabled || listing === 'loading'}
            onClick={() => void listProviderModels(providerId)}
          >
            {listing !== undefined && listing !== 'loading' && listing.status === 'listed'
              ? `Reload models from ${name}`
              : `Load models from ${name}`}
          </Button>
          <p role="status" className="text-sm text-ink-400">
            {listing === 'loading'
              ? `Asking ${name}…`
              : listing?.status === 'listed'
                ? `${String(listing.models.length)} models listed by your ${name} sign-in at ${formatTime(listing.checkedAt)}.`
                : ''}
          </p>
          {listing !== undefined && listing !== 'loading' && listing.status === 'failed' && (
            <p role="alert" className="w-full text-sm text-motion">
              Error: {listing.message}
            </p>
          )}
        </div>
      )}

      {choices.availability === 'notListed' && choices.effectiveModel !== null && (
        <p className="flex gap-1.5 text-sm text-signal-warn">
          <span className="mt-0.5 flex-none">
            <WarningIcon size={14} />
          </span>
          {choices.effectiveModel} is not in the list {name} reported for your sign-in. The run may
          fail; choose a listed model or the default.
        </p>
      )}

      <p id={noteId} className="text-sm text-ink-400">
        Next run uses <span className="font-medium text-ink-100">{choices.effectiveLabel}</span>.
        {choices.note === '' ? '' : ` ${choices.note}`}
      </p>
    </div>
  );
}
