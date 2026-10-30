import type { KomaProject } from '@koma-motion/core';
import { useId, type ReactElement } from 'react';
import type { DetectedProvider } from '../state/agentStore';
import { useProjectStore } from '../state/projectStore';
import { useAgentStore } from '../state/agentStore';
import { cancelGeneration } from '../lib/agentActions';
import { changeAgentConfiguration } from '../state/commands';
import type { ComposerDraft } from '../lib/useComposerDraft';
import type { ComposerPanel } from '../lib/useComposerPanel';
import { CheckIcon, ChevronIcon, SendIcon, WarningIcon } from './icons';
import { ModelPicker, useModelChoices } from './ModelPicker';
import { CompactModelPicker } from './CompactModelPicker';
import { ProviderLogo } from './ProviderLogo';
import { ReferenceFiles, ReferenceAttachmentButton } from './ReferenceFiles';
import { ChatBrandKitPicker } from './ChatBrandKitPicker';
import { BrandMaterial } from './BrandMaterial';
import { Button, Help, POPOVER_SURFACE, Select, TextInput } from './ui';

function describeAvailability(provider: DetectedProvider): string {
  switch (provider.detection.availability) {
    case 'available':
      return provider.detection.version === null
        ? 'available'
        : `version ${provider.detection.version}`;
    case 'unavailable':
      return 'not installed';
    case 'error':
      return 'not working';
  }
}

function Availability({ provider }: { readonly provider: DetectedProvider }): ReactElement {
  const available = provider.detection.availability === 'available';
  return (
    <p
      role="status"
      className={`flex items-center gap-0.5 ${available ? 'text-signal-ok' : 'text-signal-warn'}`}
    >
      {available ? <CheckIcon size={14} /> : <WarningIcon size={14} />}
      <span>{available ? 'Ready' : 'Not available'}</span>
      <Help label="Provider details">{provider.detection.message}</Help>
    </p>
  );
}

export function AgentComposer({
  project,
  draft,
  panel,
}: {
  readonly project: KomaProject;
  readonly draft: ComposerDraft;
  readonly panel: ComposerPanel;
}): ReactElement {
  const {
    request,
    setRequest,
    requestError,
    scope,
    setScope,
    proposal,
    selectedKoma,
    running,
    selectedId,
    selected,
    providers,
    detection,
    available,
    providerName,
    validCount,
    komaCount,
    setKomaCount,
    autoKomaCount,
    setAutoKomaCount,
    canSubmit,
    references,
    needsReferenceConsent,
    referenceConsent,
    setReferenceConsent,
    consentKey,
    submit,
  } = draft;
  const {
    composer,
    choice,
    setChoice,
    requestField,
    modelButton,
    countButton,
    choicesPanel,
    pickerMaxHeight,
  } = panel;
  const apply = useProjectStore((state) => state.apply);
  const stopping = useAgentStore((state) => state.execution?.cancelRequested ?? false);
  const models = useModelChoices(project, selected);
  const requestId = useId();
  const requestErrorId = useId();
  const providerId = useId();
  const countId = useId();
  const countErrorId = useId();
  const modelChoicesId = useId();
  const countChoicesId = useId();
  return (
    <form
      ref={composer}
      className="chat-composer relative flex min-h-0 flex-none flex-col gap-2 overflow-visible"
      onSubmit={(event) => {
        event.preventDefault();
        submit(request);
        requestField.current?.focus();
      }}
    >
      <Select
        className="chat-scope"
        aria-label="Generation scope"
        value={scope}
        disabled={running || proposal !== null}
        onChange={(event) => {
          setScope(event.target.value === 'selected' ? 'selected' : 'entire');
          setChoice(null);
        }}
      >
        <option value="entire">Entire presentation</option>
        <option value="selected" disabled={selectedKoma === undefined}>
          Selected Koma
        </option>
      </Select>
      <div className="chat-composer-surface">
        <label htmlFor={requestId} className="sr-only">
          Your request
        </label>
        <textarea
          data-guide-target="request"
          id={requestId}
          ref={requestField}
          rows={1}
          className="chat-request"
          aria-invalid={requestError === undefined ? undefined : true}
          aria-describedby={requestError === undefined ? undefined : requestErrorId}
          value={request}
          placeholder={
            scope === 'selected'
              ? 'Describe changes to the selected Koma…'
              : 'Describe the presentation…'
          }
          onChange={(event) => setRequest(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.altKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              submit(request);
            }
          }}
        />
        {requestError !== undefined && (
          <p id={requestErrorId} role="alert" className="text-sm text-motion">
            Error: {requestError}
          </p>
        )}

        <div
          role="group"
          aria-label="Generation choices"
          className="chat-composer-toolbar relative"
        >
          <ReferenceAttachmentButton disabled={running} />
          <button
            ref={modelButton}
            type="button"
            aria-label="Model"
            aria-description={
              models.selectable
                ? `Next run uses ${models.effectiveLabel}${models.availability === 'notListed' ? ', not in the latest CLI list' : ''}`
                : `${providerName} has no model choice`
            }
            aria-haspopup="dialog"
            aria-expanded={choice === 'model'}
            aria-controls={choice === 'model' ? modelChoicesId : undefined}
            disabled={running}
            title={`${providerName}: next run uses ${models.effectiveLabel}`}
            className="chat-model-trigger"
            onClick={() => setChoice(choice === 'model' ? null : 'model')}
          >
            <ProviderLogo providerId={selectedId} size={15} />
            <span className="min-w-0 flex-1 truncate">
              {models.effectiveModel === null
                ? `${providerName} · ${models.selectable ? 'Default' : 'Demo'}`
                : (models.options
                    .find((option) => option.value === models.value)
                    ?.label.split(' · ')[0] ?? models.effectiveModel)}
            </span>
            {(models.availability === 'notListed' ||
              detection === 'failed' ||
              (detection === 'done' && !available)) && (
              <span className="flex-none text-signal-warn" aria-hidden="true">
                <WarningIcon size={14} />
              </span>
            )}
            <ChevronIcon direction="down" size={14} />
          </button>
          <ChatBrandKitPicker
            project={project}
            maxHeight={pickerMaxHeight}
            disabled={running}
            open={choice === 'brand'}
            onOpenChange={(next) => setChoice(next ? 'brand' : null)}
          />
          <button
            ref={countButton}
            disabled={running || scope === 'selected'}
            type="button"
            aria-label="Koma count"
            aria-description={
              scope === 'selected'
                ? 'One Koma proposal for the selected Koma'
                : validCount
                  ? autoKomaCount
                    ? 'Automatic Koma count'
                    : `${komaCount} Komas`
                  : 'Invalid Koma count. Enter a whole number from 1.'
            }
            aria-haspopup="dialog"
            aria-expanded={choice === 'count'}
            aria-controls={choice === 'count' ? countChoicesId : undefined}
            aria-invalid={validCount ? undefined : true}
            aria-describedby={validCount ? undefined : countErrorId}
            className={`chat-count-trigger ${validCount ? '' : 'text-motion'}`}
            onClick={() => setChoice(choice === 'count' ? null : 'count')}
          >
            <span>
              {scope === 'selected'
                ? '1 Koma'
                : validCount
                  ? autoKomaCount
                    ? 'Auto Komas'
                    : `${komaCount} Komas`
                  : 'Set Komas'}
            </span>
            <ChevronIcon direction="down" size={14} />
          </button>
          <button
            type={running ? 'button' : 'submit'}
            aria-label={running ? 'Stop generating' : 'Generate Komas'}
            title={
              running ? 'Stop generating' : 'Generate Komas (Enter). Shift+Enter for a new line.'
            }
            disabled={running ? stopping : !canSubmit}
            onClick={
              running
                ? () => {
                    void cancelGeneration();
                    requestField.current?.focus();
                  }
                : undefined
            }
            className="chat-send"
          >
            {running ? (
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" />
              </svg>
            ) : (
              <SendIcon size={18} />
            )}
          </button>
          {!validCount && (
            <span id={countErrorId} className="sr-only">
              Enter a whole number from 1.
            </span>
          )}
        </div>
      </div>
      <p className="chat-keyboard-hint">
        Enter to send <span aria-hidden="true">·</span> Shift+Enter for a new line
      </p>
      {project.agentConfiguration.timeoutSeconds !== null && (
        <p className="px-2 text-xs text-ink-400">
          Stops after {String(project.agentConfiguration.timeoutSeconds)} seconds. Change the limit
          under Settings, Generation.
        </p>
      )}

      <ReferenceFiles disabled={running} showButton={false} />
      {needsReferenceConsent && (
        <label className="flex items-start gap-2 text-xs text-ink-300">
          <input
            type="checkbox"
            checked={referenceConsent === consentKey}
            disabled={running}
            onChange={(event) => setReferenceConsent(event.target.checked ? consentKey : null)}
          />
          <span>Send the extracted reference text to {providerName} with this request.</span>
        </label>
      )}
      <BrandMaterial disabled={running} />
      {references.length > 0 && selectedId === 'mock' && (
        <p className="text-xs text-ink-400">
          Mock repeats its demo and does not use reference content.
        </p>
      )}

      {choice === 'model' && (
        <div
          ref={choicesPanel}
          id={modelChoicesId}
          role="dialog"
          aria-label="Model"
          style={{ maxHeight: Math.min(pickerMaxHeight ?? 560, 560) }}
          className={`absolute bottom-[calc(100%+0.5rem)] left-3 z-30 flex max-h-[min(35rem,72vh)] w-[min(22rem,calc(100vw-2rem))] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden ${POPOVER_SURFACE}`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setChoice(null);
              modelButton.current?.focus();
            }
          }}
          onBlur={(event) => {
            if (
              event.relatedTarget instanceof Node &&
              !event.currentTarget.contains(event.relatedTarget) &&
              !modelButton.current?.contains(event.relatedTarget)
            )
              setChoice(null);
          }}
        >
          <CompactModelPicker
            project={project}
            disabled={running}
            onClose={() => {
              setChoice(null);
              modelButton.current?.focus();
            }}
          >
            <label htmlFor={providerId} className="text-xs font-medium text-ink-300">
              Provider
            </label>
            <Select
              id={providerId}
              value={selectedId}
              disabled={running}
              onChange={(event) =>
                apply(
                  changeAgentConfiguration({
                    ...project.agentConfiguration,
                    selectedProviderId: event.target.value,
                  }),
                )
              }
            >
              {providers.length === 0 && <option value={selectedId}>{selectedId}</option>}
              {providers.map((provider) => (
                <option key={provider.metadata.id} value={provider.metadata.id}>
                  {provider.metadata.displayName} ({describeAvailability(provider)})
                </option>
              ))}
            </Select>
            {detection === 'running' && (
              <p role="status" className="text-xs text-ink-300">
                Checking providers
              </p>
            )}
            {detection === 'failed' && (
              <p role="alert" className="text-xs text-motion">
                Error: the providers could not be checked.
              </p>
            )}
            {detection === 'done' && selected !== undefined && <Availability provider={selected} />}
            {selectedId === 'mock' && (
              <p className="text-xs text-ink-300">
                {scope === 'selected' ? 'Demo only · 1 Koma proposal' : 'Demo only · 3 Komas'}
              </p>
            )}
            {selected?.metadata.usesExternalService === true && (
              <p className="text-xs leading-snug text-ink-300">
                {selected.metadata.displayName} sends your request, instructions, Brand Kit, Koma
                text and asset names online.
              </p>
            )}
            <ModelPicker
              key={selectedId}
              project={project}
              provider={selected}
              label="Model"
              disabled={running}
            />
          </CompactModelPicker>
        </div>
      )}
      {choice === 'count' && (
        <div
          ref={choicesPanel}
          id={countChoicesId}
          role="dialog"
          aria-label="Koma count"
          className={`absolute right-3 bottom-[calc(100%+0.5rem)] z-30 flex w-[min(16rem,calc(100vw-2rem))] max-w-[calc(100%-1.5rem)] flex-col gap-2 p-3 ${POPOVER_SURFACE}`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setChoice(null);
              countButton.current?.focus();
            }
          }}
          onBlur={(event) => {
            if (
              event.relatedTarget instanceof Node &&
              !event.currentTarget.contains(event.relatedTarget) &&
              !countButton.current?.contains(event.relatedTarget)
            )
              setChoice(null);
          }}
        >
          <label htmlFor={countId} className="text-xs font-medium text-ink-300">
            Komas
          </label>
          <div className="flex gap-2">
            <TextInput
              id={countId}
              type="number"
              className="min-w-0 w-full tabular-nums"
              min={1}
              step={1}
              aria-invalid={validCount ? undefined : true}
              aria-describedby={validCount ? undefined : countErrorId}
              disabled={autoKomaCount}
              value={autoKomaCount ? '' : komaCount}
              onChange={(event) => setKomaCount(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                if (validCount) {
                  setChoice(null);
                  countButton.current?.focus();
                }
              }}
            />
            <Button
              variant="outline"
              compact
              active={autoKomaCount}
              aria-pressed={autoKomaCount}
              title="Let the agent choose a suitable number of Komas"
              onClick={() => setAutoKomaCount(!autoKomaCount)}
            >
              Auto
            </Button>
          </div>
          {!validCount && (
            <p role="alert" className="text-xs text-motion">
              Enter a whole number from 1.
            </p>
          )}
          {project.presentation.komas.length > 0 && (
            <p className="text-xs text-ink-300">Replaces current Komas. Undo is available.</p>
          )}
        </div>
      )}
    </form>
  );
}
