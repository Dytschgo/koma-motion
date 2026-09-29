/**
 * Preferences of the application that do not belong to a project. They are
 * stored in the data folder of the user, which only the main process reads
 * and writes.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '@koma-motion/project-format/node';
import { z } from 'zod';
import { DEFAULT_UPDATE_CHANNEL, updateChannelSchema } from '../../shared/updates';

const FILE_NAME = 'preferences.json';
const MAX_FILE_LENGTH = 16 * 1024;

const preferencesSchema = z.object({
  updateChannel: updateChannelSchema.catch(DEFAULT_UPDATE_CHANNEL),
});
export type Preferences = z.infer<typeof preferencesSchema>;

export const DEFAULT_PREFERENCES: Preferences = { updateChannel: DEFAULT_UPDATE_CHANNEL };

/** Reads the preferences. A missing or damaged file gives the defaults. */
export async function readPreferences(directory: string): Promise<Preferences> {
  try {
    const text = await readFile(join(directory, FILE_NAME), 'utf8');
    if (text.length > MAX_FILE_LENGTH) {
      return DEFAULT_PREFERENCES;
    }
    const document: unknown = JSON.parse(text);
    const parsed = preferencesSchema.safeParse(document);
    return parsed.success ? parsed.data : DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function writePreferences(directory: string, preferences: Preferences): Promise<void> {
  const validated = preferencesSchema.parse(preferences);
  await writeFileAtomic(join(directory, FILE_NAME), `${JSON.stringify(validated, null, 2)}\n`);
}
