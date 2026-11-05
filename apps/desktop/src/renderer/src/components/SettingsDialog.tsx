import type { KomaProject } from '@koma-motion/core';
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { IpcResponse } from '../../../shared/ipc';
import { detectProviders } from '../lib/agentActions';
import { invoke } from '../lib/api';
import { generationTimeLimits } from '../lib/generationTimeLimit';
import {
  getSettingsPage,
  groupSettingsPages,
  movePage,
  SETTINGS_PAGES,
  SETTINGS_SCOPES,
  type SettingsPageId,
} from '../lib/settingsPages';
import { useAgentStore, type DetectedProvider } from '../state/agentStore';
import { changeAgentConfiguration } from '../state/commands';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import {
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  GenerationIcon,
  InfoIcon,
  InstructionsIcon,
  ProviderIcon,
  RefreshIcon,
  TemplatesIcon,
  WarningIcon,
} from './icons';
import { NoProject, useInstructionSettings } from './InstructionSettings';
import {
  Badge,
  Button,
  Field,
  IconButton,
  IconTile,
  ModalFrame,
  Select,
  SettingsCard,
  choiceRowClass,
} from './ui';
import { ProviderLogo } from './ProviderLogo';
import { UpdateControl } from './UpdateControl';

const REPOSITORY_URL = 'https://github.com/Dytschgo/koma-motion';

type ApplicationInfo = IpcResponse<'koma:app:get-info'>;

const PAGE_ICONS: Readonly<Record<SettingsPageId, (props: { size?: number }) => ReactElement>> = {
  instructions: InstructionsIcon,
  generation: GenerationIcon,
  templates: TemplatesIcon,
  providers: ProviderIcon,
  updates: DownloadIcon,
  about: InfoIcon,
};

function GenerationPage({ project }: { readonly project: KomaProject | null }): ReactElement {
  const apply = useProjectStore((state) => state.apply);
  if (project === null) {
    return <NoProject />;
  }
  const { timeoutSeconds } = project.agentConfiguration;
  const limits = generationTimeLimits(timeoutSeconds);
  return (
    <div className="flex flex-col gap-4">
      <SettingsCard title="Time limit">
        <Field
          label="Generation time limit"
          hint="No limit lets the provider finish or wait for you to stop it."
        >
          {(ids) => (
            <Select
              {...ids}
              value={timeoutSeconds === null ? 'none' : String(timeoutSeconds)}
              onChange={(event) => {
                const limit = limits.find((option) => option.value === event.target.value);
                if (limit === undefined) return;
                apply(
                  changeAgentConfiguration({
                    ...project.agentConfiguration,
                    timeoutSeconds: limit.seconds,
                  }),
                );
              }}
            >
              {limits.map((limit) => (
                <option key={limit.value} value={limit.value}>
                  {limit.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </SettingsCard>

      <SettingsCard title="Model">
        <Button variant="outline" onClick={() => useUiStore.getState().showModelPicker()}>
          Choose model in chat
        </Button>
      </SettingsCard>
    </div>
  );
}

function ProvidersPage({
  providers,
}: {
  readonly providers: readonly DetectedProvider[];
}): ReactElement {
  const detection = useAgentStore((state) => state.detection);
  const running = useAgentStore((state) => state.execution !== null);
  return (
    <SettingsCard
      title="Available providers"
      description="Koma Motion starts these programs on this computer. It never stores their sign-in."
      action={
        <Button
          variant="outline"
          compact
          icon={<RefreshIcon size={14} />}
          disabled={detection === 'running' || running}
          onClick={() => void detectProviders()}
        >
          Refresh providers
        </Button>
      }
    >
      {detection === 'failed' && (
        <p role="alert" className="mb-2 text-motion">
          Error: the providers could not be checked.
        </p>
      )}
      <ul className="flex flex-col divide-y divide-line">
        {providers.map((provider) => {
          const available = provider.detection.availability === 'available';
          return (
            <li key={provider.metadata.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <IconTile>
                <ProviderLogo providerId={provider.metadata.id} />
              </IconTile>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold">{provider.metadata.displayName}</span>
                  <Badge tone={available ? 'ok' : 'warn'}>
                    <span aria-hidden="true" className="mr-1 inline-flex">
                      {available ? <CheckIcon size={12} /> : <WarningIcon size={12} />}
                    </span>
                    {available
                      ? provider.detection.version === null
                        ? 'Ready'
                        : `Ready · version ${provider.detection.version}`
                      : 'Not available'}
                  </Badge>
                </p>
                <p className="mt-0.5 text-ink-300">{provider.metadata.description}</p>
                {!(
                  available &&
                  provider.detection.version !== null &&
                  provider.detection.message ===
                    `Version ${provider.detection.version} is installed.`
                ) && <p className="mt-1 text-sm text-ink-400">{provider.detection.message}</p>}
                {provider.metadata.usesExternalService && (
                  <p className="mt-1 text-sm text-ink-400">
                    Sends your request, instructions, Brand Kit, Koma text and asset names online.
                  </p>
                )}
              </div>
            </li>
          );
        })}
        {providers.length === 0 && detection !== 'failed' && (
          <li className="text-ink-400">Checking providers…</li>
        )}
      </ul>
    </SettingsCard>
  );
}

function AboutPage({ info }: { readonly info: ApplicationInfo | null }): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <SettingsCard title="Koma Motion">
        <p className="text-ink-300">
          Koma Motion {info?.version ?? ''} is an early-stage prototype, released under the MIT
          licence.
        </p>
        <p className="mt-2">
          <a
            className="text-accent underline underline-offset-2 hover:text-ink-100"
            href={REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
          >
            Koma Motion on GitHub
          </a>
        </p>
      </SettingsCard>
      <SettingsCard title="Export">
        {info === null ? (
          <p className="text-ink-400">Loading</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {info.exporters.map((exporter) => (
              <li key={exporter.id} className="py-2 first:pt-0 last:pb-0">
                <p className="font-semibold">
                  {exporter.displayName}: {exporter.available ? 'available' : 'not available yet'}
                </p>
                {exporter.note !== '' && <p className="text-ink-300">{exporter.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
    </div>
  );
}

/**
 * Settings in two panes, after the pattern of Imnota: categories on the
 * left, grouped by where they are stored, and one page on the right. Every
 * page stays mounted, so unfinished input survives switching pages.
 */
export function SettingsDialog({
  project,
}: {
  readonly project: KomaProject | null;
}): ReactElement {
  const open = useUiStore((state) => state.settingsOpen);
  const setOpen = useUiStore((state) => state.setSettingsOpen);
  const pageId = useUiStore((state) => state.settingsPage);
  const setPage = useUiStore((state) => state.setSettingsPage);
  const providers = useAgentStore((state) => state.providers);
  const [info, setInfo] = useState<ApplicationInfo | null>(null);
  const instructions = useInstructionSettings(project, open);
  const titleId = useId();
  const navigation = useRef<HTMLElement>(null);
  const page = getSettingsPage(pageId);
  const scope = SETTINGS_SCOPES[page.scope];

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

  const pages: Readonly<Record<SettingsPageId, ReactNode>> = {
    instructions: instructions.projectPage,
    generation: <GenerationPage project={project} />,
    templates: instructions.libraryPage,
    providers: <ProvidersPage providers={providers} />,
    updates: <UpdateControl />,
    about: <AboutPage info={info} />,
  };

  return (
    <ModalFrame
      open={open}
      onClose={close}
      labelledBy={titleId}
      className="h-[min(680px,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] w-[min(960px,calc(100vw-2rem))]"
    >
      <div className="grid h-full min-h-0 grid-cols-[13.5rem_minmax(0,1fr)]">
        <nav
          ref={navigation}
          aria-label="Settings categories"
          className="flex min-h-0 flex-col gap-5 overflow-y-auto border-r border-line bg-surface-1 px-3 pt-5 pb-4"
        >
          <h2 id={titleId} className="px-2 text-lg font-semibold tracking-tight">
            Settings
          </h2>
          {groupSettingsPages().map((group) => (
            <div key={group.heading} className="flex flex-col gap-0.5">
              <p className="eyebrow px-2 pb-1">{group.heading}</p>
              {group.heading === SETTINGS_SCOPES.project.group && (
                <p
                  className="truncate px-2 pb-1.5 text-sm text-ink-300"
                  title={project?.name ?? undefined}
                >
                  {project?.name ?? 'No project open'}
                </p>
              )}
              {group.pages.map((item) => {
                const Icon = PAGE_ICONS[item.id];
                const current = item.id === pageId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-settings-page={item.id}
                    aria-current={current ? 'page' : undefined}
                    className={`flex h-9 items-center gap-2.5 px-2.5 text-left ${choiceRowClass(current)} ${
                      current ? 'font-medium text-ink-100' : 'text-ink-300 hover:text-ink-100'
                    }`}
                    onClick={() => setPage(item.id)}
                    onKeyDown={(event) => {
                      const next = movePage(item.id, event.key);
                      if (next === null) return;
                      event.preventDefault();
                      setPage(next);
                      navigation.current
                        ?.querySelector<HTMLButtonElement>(`[data-settings-page="${next}"]`)
                        ?.focus();
                    }}
                  >
                    <span className={current ? 'text-accent' : 'text-ink-400'}>
                      <Icon />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-col">
          <header className="flex items-start gap-4 border-b border-line px-7 pt-5 pb-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <h3 className="text-xl font-semibold tracking-tight">{page.label}</h3>
              </div>
              <p className="mt-1 text-ink-300">{page.description}</p>
              <p className="mt-0.5 text-sm text-ink-400">{scope.note}</p>
            </div>
            <IconButton label="Close settings" onClick={close}>
              <CloseIcon />
            </IconButton>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5 [scrollbar-gutter:stable]">
            {SETTINGS_PAGES.map(({ id }) => (
              <div key={id} hidden={id !== pageId} data-settings-content={id}>
                {pages[id]}
              </div>
            ))}
          </div>
          <footer className="flex items-center justify-end gap-2 border-t border-line px-7 py-3">
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </footer>
        </div>
      </div>
    </ModalFrame>
  );
}
