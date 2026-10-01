import type { ReactElement } from 'react';
import { UPDATE_CHANNELS, type UpdateStatus } from '../../../shared/updates';
import {
  checkForUpdates,
  chooseUpdateChannel,
  downloadUpdate,
  installUpdate,
} from '../lib/updateActions';
import { selectHasUnsavedChanges, useProjectStore } from '../state/projectStore';
import { isUpdateLocked, useUpdateStore } from '../state/updateStore';
import { DownloadIcon, RefreshIcon, WarningIcon } from './icons';
import { Button, Field, Select } from './ui';

const CHANNEL_LABELS = {
  stable: 'Stable (recommended)',
  nightly: 'Nightly (preview)',
} as const;

function describe(status: UpdateStatus): string {
  if (status.message !== undefined) {
    return status.message;
  }
  switch (status.state) {
    case 'idle':
      return 'Check whether a newer version of Koma Motion exists.';
    case 'checking':
      return 'Checking for updates';
    case 'not-available':
      return 'You have the latest version.';
    case 'available':
      return `Koma Motion ${status.version ?? ''} is available.`;
    case 'downloading':
      return `Downloading the update: ${String(Math.round(status.percent ?? 0))} percent`;
    case 'downloaded':
      return 'The update is downloaded. It is installed when you restart.';
    case 'error':
      return 'The update failed. Try again.';
  }
}

/** Channel, state and actions of updating. Nothing happens without a click. */
export function UpdateControl(): ReactElement {
  const status = useUpdateStore((state) => state.status);
  const busy = useUpdateStore((state) => state.busy);
  const failure = useUpdateStore((state) => state.failure);
  const locked = useUpdateStore(isUpdateLocked);
  const hasUnsavedChanges = useProjectStore(selectHasUnsavedChanges);

  if (status === null) {
    return (
      <section className="flex flex-col gap-3 rounded-card border border-line bg-surface-1/70 p-4">
        <h4 className="font-semibold">App updates</h4>
        <p className="text-ink-400">Loading</p>
      </section>
    );
  }

  const percent = Math.max(0, Math.min(100, status.percent ?? 0));
  const canOpenPage =
    status.manualDownload === true &&
    (status.state === 'available' || status.state === 'not-available');

  return (
    <section
      className="flex flex-col gap-3 rounded-card border border-line bg-surface-1/70 p-4"
      aria-label="App updates"
    >
      <h4 className="font-semibold">App updates</h4>
      <p className="text-ink-300">
        Installed version: <span className="select-text">{status.currentVersion}</span>
      </p>

      <Field
        label="Update channel"
        hint={
          status.channel === 'nightly'
            ? 'Nightly versions contain unfinished changes. Keep copies of your projects.'
            : undefined
        }
      >
        {(ids) => (
          <Select
            {...ids}
            className="w-64"
            value={status.channel}
            disabled={locked}
            onChange={(event) => {
              const channel = UPDATE_CHANNELS.find((item) => item === event.target.value);
              if (channel !== undefined && channel !== status.channel) {
                void chooseUpdateChannel(channel);
              }
            }}
          >
            {UPDATE_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {CHANNEL_LABELS[channel]}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <p
        role="status"
        aria-live="polite"
        className={status.state === 'error' ? 'text-motion' : 'text-ink-100'}
      >
        {status.state === 'error' && 'Error: '}
        {describe(status)}
      </p>

      {failure !== null && (
        <p role="alert" className="flex gap-2 text-motion">
          <span className="mt-0.5 flex-none">
            <WarningIcon size={14} />
          </span>
          Error: {failure}
        </p>
      )}

      {status.state === 'downloading' && (
        <div
          role="progressbar"
          aria-label="Progress of the download"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          className="h-1.5 overflow-hidden rounded-full bg-line"
        >
          <div
            className="h-full origin-left bg-accent"
            style={{ transform: `scaleX(${String(percent / 100)})` }}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          icon={<RefreshIcon size={14} />}
          disabled={locked}
          onClick={() => void checkForUpdates()}
        >
          {status.state === 'error' ? 'Check again' : 'Check for updates'}
        </Button>

        {status.state === 'available' && status.manualDownload !== true && (
          <Button
            variant="primary"
            icon={<DownloadIcon size={14} />}
            disabled={busy}
            onClick={() => void downloadUpdate()}
          >
            Download update
          </Button>
        )}

        {canOpenPage && (
          <Button
            variant={status.state === 'available' ? 'primary' : 'outline'}
            disabled={busy}
            onClick={() => void downloadUpdate()}
          >
            Open the download page
          </Button>
        )}

        {status.state === 'downloaded' && (
          <Button
            variant="primary"
            disabled={busy || status.installing === true || hasUnsavedChanges}
            onClick={() => void installUpdate()}
          >
            {status.installing === true ? 'Preparing to restart' : 'Restart to install'}
          </Button>
        )}
      </div>

      {status.state === 'downloaded' && hasUnsavedChanges && (
        <p className="text-sm text-signal-warn">
          Save your project first. Installing restarts Koma Motion.
        </p>
      )}

      <details className="text-sm text-ink-400">
        <summary className="cursor-pointer hover:text-ink-100">
          What updating sends and does
        </summary>
        <p className="mt-1 max-w-[62ch]">
          Checking asks GitHub which versions of Koma Motion exist. It sends nothing about you or
          your projects. Koma Motion checks when it starts and every four hours.
        </p>
        <p className="mt-1 max-w-[62ch]">
          {status.manualDownload === true
            ? 'This version cannot install updates by itself. It opens the download page, and you replace the application.'
            : 'An update is downloaded when you choose to, and installed when you choose to restart.'}
        </p>
      </details>
    </section>
  );
}
