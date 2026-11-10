import type { ProviderRegistry } from '@koma-motion/agent-runtime';
import type { BrowserWindow } from 'electron';
import type { IpcEventChannel, IpcEventPayload } from '../../../shared/ipc';
import type { BrandKitLibrary } from '../../services/brandKitLibrary';
import type { ProjectSession } from '../../services/projectFiles';
import type { UpdateService } from '../../updates/service';
import type { HandleChannel } from '../handle';

export interface WindowContext {
  readonly window: BrowserWindow;
  readonly session: ProjectSession;
  readonly updates: UpdateService;
  /** Saved Brand Kits of this computer, shared by every project. */
  readonly brandKits: BrandKitLibrary;
  /** Closes the window without asking about unsaved changes again. */
  closeConfirmed(): void;
  /** Called when the unsaved state or the file of the project changes. */
  projectStateChanged(): void;
}

/** Sends an event to the page of the window, checked against its schema. */
export type SendEvent = <C extends IpcEventChannel>(
  channel: C,
  payload: IpcEventPayload<C>,
) => void;

/** What the handlers of one feature are given. */
export interface HandlerScope {
  readonly context: WindowContext;
  readonly handle: HandleChannel;
  readonly send: SendEvent;
  readonly registry: ProviderRegistry;
  /**
   * Stops generations and analyses. They belong to the open project, so this
   * runs when the project is replaced and when the page is lost.
   */
  readonly cancelWork: () => void;
}
