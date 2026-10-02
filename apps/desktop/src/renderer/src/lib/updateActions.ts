/** Updates: the steps between the settings and the main process. */
import type { UpdateChannel } from '../../../shared/updates';
import { useUpdateStore } from '../state/updateStore';
import { useUiStore } from '../state/uiStore';
import { invoke, subscribe } from './api';

const ACTION_FAILED = 'The update action failed. Try again.';

type UpdateAction =
  | 'koma:updates:check'
  | 'koma:updates:download'
  | 'koma:updates:copy-command'
  | 'koma:updates:install'
  | 'koma:updates:set-channel';

/** Follows the state of updating. Returns the function that stops following. */
export function followUpdates(): () => void {
  let received = false;
  const unsubscribe = subscribe('koma:updates:status', (status) => {
    received = true;
    useUpdateStore.getState().setStatus(status);
  });
  invoke('koma:updates:get-status', {}).then(
    (status) => {
      // A status that arrived in the meantime is newer than this answer.
      if (!received) {
        useUpdateStore.getState().setStatus(status);
      }
    },
    () => undefined,
  );
  return unsubscribe;
}

async function run(
  action: () => Promise<{ status: 'done' } | { status: 'failed'; message: string }>,
): Promise<void> {
  const updates = useUpdateStore.getState();
  if (updates.busy) {
    return;
  }
  updates.setBusy(true);
  updates.setFailure(null);
  try {
    const result = await action();
    if (result.status === 'failed') {
      useUpdateStore.getState().setFailure(result.message);
    }
  } catch {
    useUpdateStore.getState().setFailure(ACTION_FAILED);
  } finally {
    useUpdateStore.getState().setBusy(false);
  }
}

function request(channel: Exclude<UpdateAction, 'koma:updates:set-channel'>): Promise<void> {
  return run(() => invoke(channel, {}));
}

export function checkForUpdates(): Promise<void> {
  return request('koma:updates:check');
}

export function downloadUpdate(): Promise<void> {
  return request('koma:updates:download');
}

export function copyUpdateCommand(): Promise<void> {
  return request('koma:updates:copy-command');
}

export function installUpdate(): Promise<void> {
  return request('koma:updates:install');
}

/** Changes the channel. Nightly asks for confirmation first. */
export async function chooseUpdateChannel(channel: UpdateChannel): Promise<void> {
  if (channel === 'nightly') {
    const confirmed = await useUiStore.getState().confirm({
      title: 'Switch to nightly versions?',
      message:
        'Nightly versions contain unfinished changes and can damage projects. Keep copies of your projects. Switching checks for a version; it does not install one.',
      confirmLabel: 'Use nightly',
      cancelLabel: 'Keep stable',
      destructive: false,
    });
    if (!confirmed) {
      return;
    }
  }
  await run(() => invoke('koma:updates:set-channel', { channel }));
}
