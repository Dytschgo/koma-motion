import { createExporters } from '@koma-motion/exporters';
import { app } from 'electron';
import type { IpcResponse } from '../../../shared/ipc';
import { canCompleteSaveAndClose } from '../../services/projectFiles';
import type { HandlerScope } from './scope';

function getPlatform(): IpcResponse<'koma:app:get-info'>['platform'] {
  switch (process.platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    default:
      return 'other';
  }
}

/** The application and its window: unsaved state, closing, full screen, updates. */
export function registerApplicationHandlers({
  context,
  handle,
}: Pick<HandlerScope, 'context' | 'handle'>): void {
  const { window, session } = context;

  handle('koma:app:set-unsaved-changes', ({ hasUnsavedChanges }) => {
    session.hasUnsavedChanges = hasUnsavedChanges;
    context.projectStateChanged();
    return {};
  });

  handle('koma:app:confirm-close', () => {
    // Refuse when the project was replaced or still has edits the save did not include.
    if (!canCompleteSaveAndClose(session)) {
      return {};
    }
    session.saveAndCloseSessionId = null;
    context.closeConfirmed();
    return {};
  });

  // Set while a presentation made the window full screen: true when it was
  // not full screen before, so ending the presentation gives it back.
  let windowedBeforePresentation: boolean | null = null;
  handle('koma:app:set-full-screen', ({ mode }) => {
    if (mode === 'enter') {
      windowedBeforePresentation ??= !window.isFullScreen();
      window.setFullScreen(true);
      return { fullScreen: true };
    }
    if (mode === 'leave') {
      window.setFullScreen(false);
      return { fullScreen: false };
    }
    const restore = windowedBeforePresentation === true;
    windowedBeforePresentation = null;
    if (restore) {
      window.setFullScreen(false);
    }
    return { fullScreen: restore ? false : window.isFullScreen() };
  });

  /** Runs an update action and turns a failure into a message for the user. */
  const act = async (
    action: () => Promise<unknown>,
  ): Promise<IpcResponse<'koma:updates:check'>> => {
    try {
      await action();
      return { status: 'done' };
    } catch (error) {
      return {
        status: 'failed',
        message: error instanceof Error ? error.message : 'The update action failed.',
      };
    }
  };

  handle('koma:updates:get-status', () => context.updates.getStatus());

  handle('koma:updates:check', () => act(() => context.updates.check()));

  handle('koma:updates:set-channel', ({ channel }) =>
    act(() => context.updates.setChannel(channel)),
  );

  handle('koma:updates:download', () => act(() => context.updates.download()));

  handle('koma:updates:copy-command', () => act(() => context.updates.copyCommand()));

  handle('koma:updates:install', () =>
    act(() => {
      // Installing restarts the application. Unsaved work must not be lost to it.
      if (session.hasUnsavedChanges) {
        return Promise.reject(new Error('Save your project before you restart to install.'));
      }
      return context.updates.install();
    }),
  );

  handle('koma:app:get-info', () => ({
    version: app.getVersion(),
    platform: getPlatform(),
    exporters: createExporters().map((exporter) => ({
      id: exporter.id,
      displayName: exporter.displayName,
      available: exporter.availability.status === 'available',
      note: exporter.availability.status === 'available' ? '' : exporter.availability.reason,
    })),
  }));
}
