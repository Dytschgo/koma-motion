import { useState, type ReactElement } from 'react';
import { invoke } from '../lib/api';
import { Button, SettingsCard } from './ui';

type DiagnosticsAction = 'koma:diagnostics:copy' | 'koma:diagnostics:open-folder';

const ACTION_FAILED = 'That did not work. Try again.';

/** Copy the newest log entries, or show the folder of the log. */
export function DiagnosticsActions(): ReactElement {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; failed: boolean } | null>(null);

  const run = async (channel: DiagnosticsAction, done: string): Promise<void> => {
    setBusy(true);
    setResult(null);
    try {
      const response = await invoke(channel, {});
      setResult(
        response.status === 'failed'
          ? { text: response.message, failed: true }
          : { text: done, failed: false },
      );
    } catch {
      setResult({ text: ACTION_FAILED, failed: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(
              'koma:diagnostics:copy',
              'Diagnostics copied. Read them before you share them.',
            )
          }
        >
          Copy diagnostics
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void run('koma:diagnostics:open-folder', 'The log folder is open.')}
        >
          Open log folder
        </Button>
      </div>
      <p
        role={result?.failed === true ? 'alert' : 'status'}
        className={`min-h-[1.25em] text-sm ${result?.failed === true ? 'text-motion' : 'text-ink-300'}`}
      >
        {result?.text ?? ''}
      </p>
    </div>
  );
}

/** The diagnostics log in Settings. */
export function DiagnosticsCard(): ReactElement {
  return (
    <SettingsCard
      title="Diagnostics log"
      description="Koma Motion keeps a small log on this computer: its version, crashes, errors, updates and failed provider runs. It records technical events, not your projects, requests or reference text. Nothing is sent anywhere; attach it to a report if you choose to."
    >
      <DiagnosticsActions />
    </SettingsCard>
  );
}
