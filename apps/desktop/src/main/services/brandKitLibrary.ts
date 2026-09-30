/**
 * The Brand Kit library on disk. It lives in the data folder of the
 * application, outside every project, so a saved Brand Kit can be used in any
 * project on this computer. Only the main process reads and writes it.
 *
 *   brand-kits/library.json          saved Brand Kits, validated on every read
 *   brand-kits/logos/<sha256>.<ext>  logo images, named by their content
 *
 * A library that cannot be read is reported and left alone. Entries that
 * cannot be read are written back unchanged. Nothing is dropped unless the
 * user deletes it.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BRAND_KIT_LIBRARY_VERSION,
  copyName,
  IMAGE_EXTENSION_BY_MEDIA_TYPE,
  MAX_BRAND_KIT_LIBRARY_BYTES,
  MAX_SAVED_BRAND_KITS,
  parseBrandKitLibrary,
  serialiseBrandKitLibrary,
  toLibraryBrandKit,
  type BrandKitLogoData,
  type SavedBrandKit,
  type SavedBrandKitLogo,
} from '@koma-motion/brand-kit';
import {
  createRandomIdGenerator,
  MAX_EMBEDDED_ASSET_BYTES,
  type BrandKit,
  type IdGenerator,
} from '@koma-motion/core';
import { writeFileAtomic } from '@koma-motion/project-format/node';
import type { IpcResponse, SavedBrandKitSummary } from '../../shared/ipc';
import { detectImageType, toDisplayName } from './imageAsset';

export const LIBRARY_FILE_NAME = 'library.json';
export const LOGO_DIRECTORY_NAME = 'logos';
const LOGO_FILE_PATTERN = /^([0-9a-f]{64})\.(png|jpg|webp|gif)$/;
const BACKUP_FILE_PATTERN = /^library\.unreadable-.*\.json$/;

type LibraryState = IpcResponse<'koma:brand-kits:list'>;
type LoadResponse = IpcResponse<'koma:brand-kits:load'>;
type StartNewResponse = IpcResponse<'koma:brand-kits:start-new'>;

export interface BrandKitContent {
  readonly brandKit: BrandKit;
  readonly logo: BrandKitLogoData | null;
  readonly provenance?: SavedBrandKit['provenance'];
}

export interface BrandKitLibrary {
  list(): Promise<LibraryState>;
  create(input: BrandKitContent & { readonly name: string }): Promise<LibraryState>;
  update(id: string, input: BrandKitContent): Promise<LibraryState>;
  rename(id: string, name: string): Promise<LibraryState>;
  duplicate(id: string): Promise<LibraryState>;
  remove(id: string): Promise<LibraryState>;
  load(id: string): Promise<LoadResponse>;
  /** Keeps an unreadable library file as a backup and starts an empty library. */
  startNew(): Promise<StartNewResponse>;
}

type Stored =
  | {
      readonly status: 'ready';
      readonly kits: readonly SavedBrandKit[];
      readonly unreadable: readonly unknown[];
    }
  | { readonly status: 'damaged'; readonly message: string; readonly canStartNew: boolean }
  | { readonly status: 'failed'; readonly message: string };

/** A failure with a sentence for the user. */
class LibraryError extends Error {}

const NOT_CHANGED = 'Your saved Brand Kits were not changed.';

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function describeWriteError(error: unknown): string {
  switch (errorCode(error)) {
    case 'EACCES':
    case 'EPERM':
      return 'Koma Motion is not allowed to write to its data folder.';
    case 'ENOSPC':
      return 'The disk is full.';
    default:
      return 'The data folder of Koma Motion could not be written.';
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function logoFileName(logo: Pick<SavedBrandKitLogo, 'sha256' | 'mediaType'>): string {
  return `${logo.sha256}.${IMAGE_EXTENSION_BY_MEDIA_TYPE[logo.mediaType]}`;
}

/** Writes bytes so readers see either no file or the complete file. */
async function writeBytesAtomic(filePath: string, bytes: Uint8Array): Promise<void> {
  const temporaryPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
  let renamed = false;
  try {
    const handle = await open(temporaryPath, 'wx');
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, filePath);
    renamed = true;
  } finally {
    if (!renamed) {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}

/**
 * Checks logo bytes from the renderer. The data must be canonical base64 of
 * an image whose content matches the declared media type.
 */
export function decodeLogo(logo: BrandKitLogoData): Buffer {
  const bytes = Buffer.from(logo.data, 'base64');
  if (bytes.byteLength === 0 || bytes.toString('base64') !== logo.data) {
    throw new LibraryError('The logo data could not be read.');
  }
  if (bytes.byteLength > MAX_EMBEDDED_ASSET_BYTES) {
    throw new LibraryError('The logo is larger than 2 MB.');
  }
  if (detectImageType(bytes) !== logo.mediaType) {
    throw new LibraryError('The logo is not a PNG, JPEG, WebP or GIF image.');
  }
  return bytes;
}

function backupTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
}

export function createBrandKitLibrary(
  directory: string,
  options: { readonly now?: () => Date; readonly idGenerator?: IdGenerator } = {},
): BrandKitLibrary {
  const now = options.now ?? (() => new Date());
  const idGenerator = options.idGenerator ?? createRandomIdGenerator();
  const libraryPath = join(directory, LIBRARY_FILE_NAME);
  const logoDirectory = join(directory, LOGO_DIRECTORY_NAME);

  // One action at a time, so two quick actions cannot overwrite each other.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work);
    queue = run.catch(() => undefined);
    return run;
  };

  async function read(): Promise<Stored> {
    let text: string;
    try {
      const details = await stat(libraryPath);
      if (!details.isFile()) {
        return {
          status: 'damaged',
          message: 'The Brand Kit library is not a file.',
          canStartNew: false,
        };
      }
      if (details.size > MAX_BRAND_KIT_LIBRARY_BYTES) {
        return {
          status: 'damaged',
          message: 'The Brand Kit library file is larger than expected and was not opened.',
          canStartNew: true,
        };
      }
      text = await readFile(libraryPath, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        return { status: 'ready', kits: [], unreadable: [] };
      }
      return { status: 'failed', message: 'The Brand Kit library could not be read.' };
    }
    // A byte order mark, as some editors write one.
    const parsed = parseBrandKitLibrary(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    switch (parsed.status) {
      case 'ready':
        return parsed;
      case 'newer':
        return {
          status: 'damaged',
          message: `The Brand Kit library was saved by a newer version of Koma Motion (library version ${String(parsed.version)}, this version reads ${String(BRAND_KIT_LIBRARY_VERSION)}). Update Koma Motion to use it. It was not changed.`,
          canStartNew: false,
        };
      case 'damaged':
        return {
          status: 'damaged',
          message: `The Brand Kit library could not be read. ${parsed.reason} It was not changed.`,
          canStartNew: true,
        };
    }
  }

  async function readReady(): Promise<Extract<Stored, { status: 'ready' }>> {
    const stored = await read();
    if (stored.status !== 'ready') {
      throw new LibraryError(
        `${stored.message.replace(/ It was not changed\.$/, '')} ${NOT_CHANGED}`,
      );
    }
    return stored;
  }

  async function logoAvailable(logo: SavedBrandKitLogo): Promise<boolean> {
    try {
      const details = await stat(join(logoDirectory, logoFileName(logo)));
      return details.isFile() && details.size === logo.byteLength;
    } catch {
      return false;
    }
  }

  async function summarise(kit: SavedBrandKit): Promise<SavedBrandKitSummary> {
    return {
      ...kit,
      logo: kit.logo === null ? null : { ...kit.logo, available: await logoAvailable(kit.logo) },
    };
  }

  async function toState(stored: Stored, kitId: string | null): Promise<LibraryState> {
    switch (stored.status) {
      case 'ready':
        return {
          status: 'ready',
          kits: await Promise.all(stored.kits.map(summarise)),
          unreadableCount: stored.unreadable.length,
          kitId,
        };
      case 'damaged':
        return stored;
      case 'failed':
        return stored;
    }
  }

  /** Stores logo bytes under their hash. An identical file is reused. */
  async function storeLogo(logo: BrandKitLogoData): Promise<SavedBrandKitLogo> {
    const bytes = decodeLogo(logo);
    const stored: SavedBrandKitLogo = {
      name: toDisplayName(logo.name),
      mediaType: logo.mediaType,
      sha256: sha256(bytes),
      byteLength: bytes.byteLength,
    };
    const filePath = join(logoDirectory, logoFileName(stored));
    try {
      const existing = await readFile(filePath);
      if (sha256(existing) === stored.sha256) {
        return stored;
      }
    } catch {
      // Not stored yet.
    }
    try {
      await mkdir(logoDirectory, { recursive: true });
      await writeBytesAtomic(filePath, bytes);
    } catch (error) {
      throw new LibraryError(
        `The logo could not be saved. ${describeWriteError(error)} ${NOT_CHANGED}`,
      );
    }
    return stored;
  }

  /** The text of every library kept aside by startNew. */
  async function readBackups(): Promise<string[]> {
    const names = await readdir(directory).catch(() => []);
    return Promise.all(
      names
        .filter((name) => BACKUP_FILE_PATTERN.test(name))
        .map((name) => readFile(join(directory, name), 'utf8').catch(() => '')),
    );
  }

  /** Removes logo files that no entry refers to, unreadable entries included. */
  async function collectLogos(
    kits: readonly SavedBrandKit[],
    unreadable: readonly unknown[],
  ): Promise<void> {
    let names: string[];
    try {
      names = await readdir(logoDirectory);
    } catch {
      return;
    }
    const used = new Set(kits.flatMap((kit) => (kit.logo === null ? [] : [kit.logo.sha256])));
    // Unreadable entries and libraries kept as backups may still refer to a
    // logo. Their logos stay, so restoring a backup restores its logos too.
    const kept = [JSON.stringify(unreadable), ...(await readBackups())];
    for (const name of names) {
      const match = LOGO_FILE_PATTERN.exec(name);
      const hash = match?.[1];
      if (hash === undefined || used.has(hash) || kept.some((text) => text.includes(hash))) {
        continue;
      }
      await unlink(join(logoDirectory, name)).catch(() => undefined);
    }
  }

  async function write(
    kits: readonly SavedBrandKit[],
    unreadable: readonly unknown[],
  ): Promise<void> {
    const text = serialiseBrandKitLibrary(kits, unreadable);
    // A library that could not be read back is never written.
    if (Buffer.byteLength(text, 'utf8') > MAX_BRAND_KIT_LIBRARY_BYTES) {
      throw new LibraryError(
        `The Brand Kit library would be larger than ${String(MAX_BRAND_KIT_LIBRARY_BYTES / 1024 / 1024)} MB. Delete a saved Brand Kit or shorten its descriptions. ${NOT_CHANGED}`,
      );
    }
    try {
      await mkdir(directory, { recursive: true });
      await writeFileAtomic(libraryPath, text);
    } catch (error) {
      throw new LibraryError(
        `The Brand Kit library could not be saved. ${describeWriteError(error)} ${NOT_CHANGED}`,
      );
    }
    await collectLogos(kits, unreadable);
  }

  /** Runs a change and reports a failure as a message, never as a partial write. */
  const change = (
    work: (
      stored: Extract<Stored, { status: 'ready' }>,
    ) => Promise<{ kits: readonly SavedBrandKit[]; kitId: string | null }>,
  ): Promise<LibraryState> =>
    serial(async () => {
      try {
        const stored = await readReady();
        const { kits, kitId } = await work(stored);
        await write(kits, stored.unreadable);
        return await toState({ ...stored, kits }, kitId);
      } catch (error) {
        // A failed library write may follow a successful new-logo write.
        // Re-read authoritative references before collecting that orphan.
        const unchanged = await read();
        if (unchanged.status === 'ready') await collectLogos(unchanged.kits, unchanged.unreadable);
        return {
          status: 'failed',
          message:
            error instanceof LibraryError
              ? error.message
              : `The Brand Kit library could not be changed. ${NOT_CHANGED}`,
        };
      }
    });

  const find = (kits: readonly SavedBrandKit[], id: string): SavedBrandKit => {
    const kit = kits.find((candidate) => candidate.id === id);
    if (kit === undefined) {
      throw new LibraryError('This saved Brand Kit no longer exists.');
    }
    return kit;
  };

  const ensureRoom = (kits: readonly SavedBrandKit[]): void => {
    if (kits.length >= MAX_SAVED_BRAND_KITS) {
      throw new LibraryError(
        `The library can hold up to ${String(MAX_SAVED_BRAND_KITS)} Brand Kits. Delete one to save another.`,
      );
    }
  };

  return {
    list: () => serial(async () => toState(await read(), null)),

    create: ({ name, brandKit, logo, provenance }) =>
      change(async ({ kits }) => {
        ensureRoom(kits);
        const timestamp = now().toISOString();
        const kit: SavedBrandKit = {
          id: idGenerator.next('kit'),
          name: name.trim(),
          createdAt: timestamp,
          updatedAt: timestamp,
          brandKit: toLibraryBrandKit(brandKit),
          logo: logo === null ? null : await storeLogo(logo),
          ...(provenance === undefined ? {} : { provenance }),
        };
        return { kits: [kit, ...kits], kitId: kit.id };
      }),

    update: (id, { brandKit, logo }) =>
      change(async ({ kits }) => {
        find(kits, id);
        const storedLogo = logo === null ? null : await storeLogo(logo);
        const updatedAt = now().toISOString();
        return {
          kits: kits.map((kit) =>
            kit.id === id
              ? { ...kit, updatedAt, brandKit: toLibraryBrandKit(brandKit), logo: storedLogo }
              : kit,
          ),
          kitId: id,
        };
      }),

    rename: (id, name) =>
      change(({ kits }) => {
        find(kits, id);
        const updatedAt = now().toISOString();
        return Promise.resolve({
          kits: kits.map((kit) => (kit.id === id ? { ...kit, name: name.trim(), updatedAt } : kit)),
          kitId: id,
        });
      }),

    duplicate: (id) =>
      change(({ kits }) => {
        const source = find(kits, id);
        ensureRoom(kits);
        const timestamp = now().toISOString();
        const copy: SavedBrandKit = {
          ...source,
          id: idGenerator.next('kit'),
          name: copyName(
            source.name,
            kits.map((kit) => kit.name),
          ),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const index = kits.indexOf(source);
        return Promise.resolve({
          kits: [...kits.slice(0, index + 1), copy, ...kits.slice(index + 1)],
          kitId: copy.id,
        });
      }),

    remove: (id) =>
      change(({ kits }) => {
        find(kits, id);
        return Promise.resolve({ kits: kits.filter((kit) => kit.id !== id), kitId: null });
      }),

    load: (id) =>
      serial(async () => {
        try {
          const { kits } = await readReady();
          const kit = find(kits, id);
          const summary = await summarise(kit);
          if (kit.logo === null) {
            return { status: 'loaded', kit: summary, logo: null, logoProblem: null };
          }
          const problem = `The logo of "${kit.name}" is missing from the library, so the Brand Kit was applied without a logo.`;
          let bytes: Buffer;
          try {
            bytes = await readFile(join(logoDirectory, logoFileName(kit.logo)));
          } catch {
            return { status: 'loaded', kit: summary, logo: null, logoProblem: problem };
          }
          if (
            bytes.byteLength !== kit.logo.byteLength ||
            sha256(bytes) !== kit.logo.sha256 ||
            detectImageType(bytes) !== kit.logo.mediaType
          ) {
            return {
              status: 'loaded',
              kit: { ...summary, logo: { ...kit.logo, available: false } },
              logo: null,
              logoProblem: `The logo of "${kit.name}" is damaged in the library, so the Brand Kit was applied without a logo.`,
            };
          }
          return {
            status: 'loaded',
            kit: summary,
            logo: {
              name: kit.logo.name,
              mediaType: kit.logo.mediaType,
              data: bytes.toString('base64'),
            },
            logoProblem: null,
          };
        } catch (error) {
          return {
            status: 'failed',
            message:
              error instanceof LibraryError
                ? error.message
                : 'The saved Brand Kit could not be read.',
          };
        }
      }),

    startNew: () =>
      serial(async () => {
        const stored = await read();
        if (stored.status !== 'damaged' || !stored.canStartNew) {
          return {
            status: 'failed',
            message:
              stored.status === 'damaged'
                ? stored.message
                : 'The Brand Kit library can be read, so nothing was moved.',
          };
        }
        const backupFileName = `library.unreadable-${backupTimestamp(now())}-${randomBytes(3).toString('hex')}.json`;
        try {
          await rename(libraryPath, join(directory, backupFileName));
        } catch (error) {
          return {
            status: 'failed',
            message: `The unreadable library could not be moved aside. ${describeWriteError(error)}`,
          };
        }
        return { status: 'started', backupFileName };
      }),
  };
}
