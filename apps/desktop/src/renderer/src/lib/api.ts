/**
 * The renderer side of the IPC contract. Every response and every event from
 * the main process is validated before the application uses it.
 */
import {
  API_KEY,
  ipcContract,
  ipcEvents,
  type IpcChannel,
  type IpcEventChannel,
  type IpcEventPayload,
  type IpcRequest,
  type IpcResponse,
  type KomaMotionBridge,
} from '../../../shared/ipc';

declare global {
  interface Window {
    readonly [API_KEY]?: KomaMotionBridge;
  }
}

function getBridge(): KomaMotionBridge {
  const bridge = window[API_KEY];
  if (bridge === undefined) {
    throw new Error('Koma Motion must run inside its desktop application.');
  }
  return bridge;
}

export async function invoke<C extends IpcChannel>(
  channel: C,
  request: IpcRequest<C>,
): Promise<IpcResponse<C>> {
  const response = await getBridge().invoke(channel, request);
  const validated = ipcContract[channel].response.safeParse(response);
  if (!validated.success) {
    throw new Error(`The application returned an unexpected response for ${channel}.`);
  }
  return validated.data as IpcResponse<C>;
}

/** Subscribes to an event of the main process. Invalid payloads are ignored. */
export function subscribe<C extends IpcEventChannel>(
  channel: C,
  listener: (payload: IpcEventPayload<C>) => void,
): () => void {
  return getBridge().subscribe(channel, (payload) => {
    const validated = ipcEvents[channel].safeParse(payload);
    if (validated.success) {
      listener(validated.data as IpcEventPayload<C>);
    }
  });
}
