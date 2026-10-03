import { create } from 'zustand';
import { selectHasUnsavedChanges, selectProject, useProjectStore } from '../state/projectStore';
import { invoke } from './api';

export const useRecoveryStatus = create<{ message: string; failed: boolean }>(() => ({
  message: '',
  failed: false,
}));
let timer: ReturnType<typeof setTimeout> | undefined;
let revision = 0;
let lastWrite: Promise<void> = Promise.resolve();
let following = false;

/** Awaitable latest-document flush; reports failures without pretending the snapshot was stored. */
export function flushRecovery(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  const state = useProjectStore.getState();
  const project = selectProject(state);
  if (!following || project === null || state.recoverySessionId === null) return lastWrite;
  const sessionId = state.recoverySessionId;
  const serial = ++revision;
  lastWrite = invoke('koma:recovery:capture', {
    sessionId,
    revision: serial,
    project,
    dirty: selectHasUnsavedChanges(state),
  })
    .then((response) => {
      if (serial !== revision || useProjectStore.getState().recoverySessionId !== sessionId) return;
      if (response.status === 'stored')
        useRecoveryStatus.setState({ message: 'Recovery snapshot saved', failed: false });
      else if (response.status === 'clean')
        useRecoveryStatus.setState({ message: '', failed: false });
      else if (response.status === 'failed')
        useRecoveryStatus.setState({ message: response.message, failed: true });
    })
    .catch(() => {
      if (serial === revision && useProjectStore.getState().recoverySessionId === sessionId)
        useRecoveryStatus.setState({
          message: 'Recovery snapshot could not be updated. Retry or save your project.',
          failed: true,
        });
    });
  return lastWrite;
}

/** Only committed project state participates; drafts, chat and reference files stay out. */
export function followRecovery(): () => void {
  following = true;
  const unsubscribe = useProjectStore.subscribe((state, previous) => {
    if (
      state.history?.present === previous.history?.present &&
      state.savedProject === previous.savedProject &&
      state.recoverySessionId === previous.recoverySessionId
    )
      return;
    clearTimeout(timer);
    if (state.recoverySessionId !== previous.recoverySessionId)
      useRecoveryStatus.setState({ message: '', failed: false });
    if (state.history === null || state.recoverySessionId === null) return;
    if (!selectHasUnsavedChanges(state)) {
      void flushRecovery();
      return;
    }
    useRecoveryStatus.setState({ message: 'Recovery snapshot pending', failed: false });
    timer = setTimeout(() => {
      void flushRecovery();
    }, 600);
  });
  return () => {
    following = false;
    clearTimeout(timer);
    unsubscribe();
  };
}
