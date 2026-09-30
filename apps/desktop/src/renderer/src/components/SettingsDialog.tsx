import {
  MAX_AGENT_TIMEOUT_SECONDS,
  MIN_AGENT_TIMEOUT_SECONDS,
  modelNameSchema,
  type KomaProject,
} from '@koma-motion/core';
import { useEffect, useState, type ReactElement } from 'react';
import type { IpcResponse } from '../../../shared/ipc';
import { invoke } from '../lib/api';
import { useAgentStore } from '../state/agentStore';
import { changeAgentConfiguration } from '../state/commands';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { Button, Field, Modal, NumberInput, TextInput } from './ui';
import { UpdateControl } from './UpdateControl';
import { useInstructionSettings } from './InstructionSettings';

const REPOSITORY_URL = 'https://github.com/Dytschgo/koma-motion';

type ApplicationInfo = IpcResponse<'koma:app:get-info'>;

function ModelField({
  project,
  providerId,
  providerName,
}: {
  readonly project: KomaProject;
  readonly providerId: string;
  readonly providerName: string;
}): ReactElement {
  const apply = useProjectStore((state) => state.apply);
  const stored = project.agentConfiguration.providers[providerId]?.model ?? null;
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? stored ?? '';
  const valid = text.trim() === '' || modelNameSchema.safeParse(text.trim()).success;

  return (
    <Field
      label={`Model for ${providerName}`}
      hint="Leave empty to use the default model of the provider."
      error={valid ? undefined : 'Use letters, digits and . _ : - only, without spaces.'}
    >
      {(ids) => (
        <TextInput
          {...ids}
          value={text}
          spellCheck={false}
          placeholder="Default"
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            const model = next.trim();
            if (model === '' || modelNameSchema.safeParse(model).success) {
              apply(
                changeAgentConfiguration({
                  ...project.agentConfiguration,
                  providers: {
                    ...project.agentConfiguration.providers,
                    [providerId]: { model: model === '' ? null : model },
                  },
                }),
                { coalesceKey: `model:${providerId}` },
              );
            }
          }}
          onBlur={() => {
            setDraft(null);
          }}
        />
      )}
    </Field>
  );
}

export function SettingsDialog({
  project,
}: {
  readonly project: KomaProject | null;
}): ReactElement {
  const open = useUiStore((state) => state.settingsOpen);
  const setOpen = useUiStore((state) => state.setSettingsOpen);
  const providers = useAgentStore((state) => state.providers);
  const apply = useProjectStore((state) => state.apply);
  const [info, setInfo] = useState<ApplicationInfo | null>(null);
  const instructions = useInstructionSettings(project, open);

  useEffect(() => {
    if (!open || info !== null) {
      return;
    }
    let active = true;
    invoke('koma:app:get-info', {}).then(
      (response) => {
        if (active) {
          setInfo(response);
        }
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [open, info]);

  const close = (): void => {
    setOpen(false);
  };

  return (
    <Modal
      title="Settings"
      open={open}
      onClose={close}
      width="wide"
      footer={
        <Button variant="primary" onClick={close}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        {instructions}
        <UpdateControl />

        <section className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold">Agent providers</h3>
          {project === null ? (
            <p className="text-ink-400">
              Provider settings are stored in the project. Create or open a project to change them.
            </p>
          ) : (
            <>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={project.agentConfiguration.timeoutSeconds !== null}
                  onChange={(event) =>
                    apply(
                      changeAgentConfiguration({
                        ...project.agentConfiguration,
                        timeoutSeconds: event.target.checked ? 3600 : null,
                      }),
                    )
                  }
                />
                Stop generation after a time limit
              </label>
              <p className="text-sm text-ink-400">
                Off by default. Agents run until they finish or you cancel. A provider may have its
                own limits.
              </p>
              {project.agentConfiguration.timeoutSeconds !== null && (
                <Field
                  label="Time limit in seconds"
                  hint="Optional safety timer. Disable it for runs of any duration."
                >
                  {(ids) => (
                    <NumberInput
                      {...ids}
                      className="w-28"
                      value={project.agentConfiguration.timeoutSeconds ?? 3600}
                      minimum={MIN_AGENT_TIMEOUT_SECONDS}
                      maximum={MAX_AGENT_TIMEOUT_SECONDS}
                      precision={0}
                      onValue={(seconds) => {
                        apply(
                          changeAgentConfiguration({
                            ...project.agentConfiguration,
                            timeoutSeconds: Math.round(seconds),
                          }),
                          { coalesceKey: 'agent-timeout' },
                        );
                      }}
                    />
                  )}
                </Field>
              )}
              {providers
                .filter((provider) => provider.metadata.supportsModelSelection)
                .map((provider) => (
                  <ModelField
                    key={provider.metadata.id}
                    project={project}
                    providerId={provider.metadata.id}
                    providerName={provider.metadata.displayName}
                  />
                ))}
            </>
          )}
          <ul className="flex flex-col gap-2">
            {providers.map((provider) => (
              <li key={provider.metadata.id} className="rounded-lg border border-desk-600 p-3">
                <p className="font-semibold">{provider.metadata.displayName}</p>
                <p className="text-ink-300">{provider.metadata.description}</p>
                <p className="mt-1 text-sm text-ink-400">{provider.detection.message}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold">Export</h3>
          {info === null ? (
            <p className="text-ink-400">Loading</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {info.exporters.map((exporter) => (
                <li key={exporter.id} className="rounded-lg border border-desk-600 p-3">
                  <p className="font-semibold">
                    {exporter.displayName}: {exporter.available ? 'available' : 'not available yet'}
                  </p>
                  {exporter.note !== '' && <p className="text-ink-300">{exporter.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold">About</h3>
          <p className="text-ink-300">
            Koma Motion {info?.version ?? ''} is an early-stage prototype, released under the MIT
            licence.
          </p>
          <p>
            <a
              className="text-pencil-blue underline underline-offset-2 hover:text-ink-100"
              href={REPOSITORY_URL}
              target="_blank"
              rel="noreferrer"
            >
              Koma Motion on GitHub
            </a>
          </p>
        </section>
      </div>
    </Modal>
  );
}
