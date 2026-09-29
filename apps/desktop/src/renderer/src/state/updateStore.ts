/** The state of updating, as the main process reports it. Nothing here is saved. */
import { create } from 'zustand';
import type { UpdateStatus } from '../../../shared/updates';

interface UpdateState {
  /** `null` until the main process answered for the first time. */
  readonly status: UpdateStatus | null;
  /** `true` while a request of the user is on its way. */
  readonly busy: boolean;
  /** A failure of the last action. It is replaced by the next status. */
  readonly failure: string | null;

  readonly setStatus: (status: UpdateStatus) => void;
  readonly setBusy: (busy: boolean) => void;
  readonly setFailure: (failure: string | null) => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  status: null,
  busy: false,
  failure: null,

  setStatus(status) {
    set({ status, failure: null });
  },
  setBusy(busy) {
    set({ busy });
  },
  setFailure(failure) {
    set({ failure });
  },
}));

/** States in which the channel must not change and no other action may start. */
export function isUpdateLocked(state: UpdateState): boolean {
  const current = state.status?.state;
  return (
    state.busy || current === 'checking' || current === 'downloading' || current === 'downloaded'
  );
}
