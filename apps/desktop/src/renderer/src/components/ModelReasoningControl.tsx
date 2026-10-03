import { useId, type ReactElement } from 'react';
import type { KomaProject } from '@koma-motion/core';
import { getReasoningSelection, withModelReasoning } from '../lib/composerChoices';
import { useAgentStore } from '../state/agentStore';
import { useProjectStore } from '../state/projectStore';
import { changeAgentConfiguration } from '../state/commands';

export function ModelReasoningControl({
  project,
  providerId,
  disabled,
}: {
  readonly project: KomaProject;
  readonly providerId: string;
  readonly disabled: boolean;
}): ReactElement | null {
  const listing = useAgentStore((state) => state.modelListings[providerId]);
  const apply = useProjectStore((state) => state.apply);
  const groupId = useId();
  const { model, capability, saved, message } = getReasoningSelection(
    project.agentConfiguration,
    providerId,
    listing,
  );
  if (model === null || (capability?.status !== 'supported' && message === null)) return null;
  const choose = (value: string | null): void => {
    apply(
      changeAgentConfiguration(
        withModelReasoning(project.agentConfiguration, providerId, model, value),
      ),
    );
  };
  return (
    <div className="mx-3 mb-3 border-t border-line pt-3" data-reasoning-panel>
      {capability?.status === 'supported' && (
        <fieldset disabled={disabled} className="min-w-0">
          <legend className="sr-only">Reasoning</legend>
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden="true" className="text-sm font-semibold text-ink-100">
              Reasoning
            </span>
            <div className="flex min-w-[10rem] flex-1 flex-wrap gap-1 rounded-control border border-line bg-surface-1 p-1">
              {capability.choices.map((choice) => (
                <label
                  key={choice.value}
                  className="relative min-w-0 flex-1 basis-auto cursor-pointer"
                >
                  <input
                    type="radio"
                    className="peer absolute inset-0 size-full cursor-pointer opacity-0"
                    name={groupId}
                    value={choice.value}
                    checked={saved === choice.value}
                    aria-label={choice.label}
                    title={choice.description}
                    onChange={() => choose(choice.value)}
                  />
                  <span className="block rounded-control px-2 py-1.5 text-center text-xs break-words text-ink-300 peer-checked:bg-accent peer-checked:font-semibold peer-checked:text-surface-0 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:opacity-50">
                    {choice.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <p className="mt-2 text-xs text-ink-300">
            {capability.choices.find((choice) => choice.value === saved)?.description ??
              (saved === null
                ? `CLI default${capability.defaultValue ? ` (${capability.choices.find((choice) => choice.value === capability.defaultValue)?.label ?? capability.defaultValue})` : ''}`
                : 'Effort reported by this model’s CLI.')}
          </p>
        </fieldset>
      )}
      {message && (
        <p role="status" className="mt-2 text-xs text-signal-warn">
          {message}
        </p>
      )}
      {saved !== null && (
        <button
          type="button"
          disabled={disabled}
          className="mt-2 text-xs text-accent underline underline-offset-2 disabled:opacity-50"
          onClick={() => choose(null)}
        >
          Use CLI default reasoning
        </button>
      )}
    </div>
  );
}
