/** Presentation actions that need the main process. */
import { usePresenterStore } from '../state/presenterStore';
import { useUiStore } from '../state/uiStore';
import { invoke, subscribe } from './api';

/**
 * Asks the main process to change full screen. `restore` gives the window
 * back the state it had before the presentation made it full screen.
 */
export async function setPresentationFullScreen(
  mode: 'enter' | 'leave' | 'restore',
): Promise<void> {
  try {
    const { fullScreen } = await invoke('koma:app:set-full-screen', { mode });
    usePresenterStore.getState().setFullScreen(fullScreen);
  } catch {
    if (mode !== 'restore') {
      useUiStore.getState().notify('error', 'Full screen is not available.');
    }
  }
}

/** Keeps the full-screen state current when the window menu or the system changes it. */
export function followFullScreen(): () => void {
  return subscribe('koma:app:full-screen', ({ fullScreen }) => {
    usePresenterStore.getState().setFullScreen(fullScreen);
  });
}
