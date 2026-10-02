/** Update channels and the state of an update, as both processes see them. */
import { z } from 'zod';

export const UPDATE_CHANNELS = ['stable', 'nightly'] as const;
export const updateChannelSchema = z.enum(UPDATE_CHANNELS);
export type UpdateChannel = z.infer<typeof updateChannelSchema>;

export const DEFAULT_UPDATE_CHANNEL: UpdateChannel = 'stable';

export const UPDATE_STATES = [
  'idle',
  'checking',
  'available',
  'not-available',
  'downloading',
  'downloaded',
  'error',
] as const;

export const updateStatusSchema = z.object({
  state: z.enum(UPDATE_STATES),
  /** The channel that is selected. */
  channel: updateChannelSchema,
  currentVersion: z.string().max(80),
  /** The version that was found, when one was found. */
  version: z.string().max(80).optional(),
  /** The channel the found version belongs to. Nightly can offer a newer stable version. */
  sourceChannel: updateChannelSchema.optional(),
  /** Page of the release on GitHub. */
  releaseUrl: z.string().max(300).optional(),
  /** A prepared macOS update command, shown for running or copying in Terminal. */
  terminalCommand: z.string().max(4096).optional(),
  /** `true` when this build uses a platform-specific update action instead of electron-updater. */
  manualDownload: z.boolean().optional(),
  /** 0 to 100 while downloading. */
  percent: z.number().min(0).max(100).optional(),
  installing: z.boolean().optional(),
  /** A sentence that can be shown to the user as it is. */
  message: z.string().max(600).optional(),
});
export type UpdateStatus = z.infer<typeof updateStatusSchema>;
export type UpdateState = UpdateStatus['state'];

/** Whether a version string names a nightly build. */
export function isNightlyVersion(version: string): boolean {
  return /-nightly\./.test(version);
}
