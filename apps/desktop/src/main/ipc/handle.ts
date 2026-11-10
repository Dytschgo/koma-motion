import type { ipcContract, IpcChannel, IpcResponse } from '../../shared/ipc';

/** Answers one channel. It receives a request that already matched the schema. */
export type Handler<C extends IpcChannel> = (
  request: ReturnType<(typeof ipcContract)[C]['request']['parse']>,
) => Promise<IpcResponse<C>> | IpcResponse<C>;

/**
 * Registers a handler behind the checks every channel shares: the sender, the
 * request schema and the response schema. Feature modules receive this
 * function instead of `ipcMain`, so they cannot register an unchecked channel.
 */
export type HandleChannel = <C extends IpcChannel>(channel: C, handler: Handler<C>) => void;
