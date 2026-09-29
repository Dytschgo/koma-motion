/**
 * Finds the release that an update channel offers. Release information is
 * untrusted input from the network: it is limited in time and size, validated
 * and reduced to the assets that belong to exactly one release.
 */
import { z } from 'zod';
import type { UpdateChannel } from '../../shared/updates';

export const REPOSITORY_URL = 'https://github.com/Dytschgo/koma-motion';
const RELEASES_API = 'https://api.github.com/repos/Dytschgo/koma-motion/releases';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 4_000_000;
const MAX_PAGES = 10;
const PAGE_SIZE = 100;

/** The two formats Koma Motion publishes: `1.2.3` and `1.2.3-nightly.20260929.1234[.2]`. */
const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-nightly\.(\d{8})\.([1-9]\d*)(?:\.([1-9]\d*))?)?$/;

type VersionParts = readonly (number | undefined)[];

export function parseReleaseVersion(version: string): VersionParts {
  const match = VERSION_PATTERN.exec(version);
  if (match === null) {
    throw new Error('The release has an unsupported version.');
  }
  const parts = match.slice(1).map((part) => (part === undefined ? undefined : Number(part)));
  if (parts.some((part) => part !== undefined && !Number.isSafeInteger(part))) {
    throw new Error('The release version is out of range.');
  }
  return parts;
}

export function isNightlyRelease(version: string): boolean {
  return parseReleaseVersion(version)[3] !== undefined;
}

/**
 * Positive when `left` is newer. A stable version is newer than every nightly
 * of the same number: `0.1.1` follows `0.1.1-nightly.20260929.1`.
 */
export function compareReleaseVersions(left: string, right: string): number {
  const a = parseReleaseVersion(left);
  const b = parseReleaseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference > 0 ? 1 : -1;
    }
  }
  if (a[3] === undefined || b[3] === undefined) {
    if (a[3] === b[3]) {
      return 0;
    }
    return a[3] === undefined ? 1 : -1;
  }
  for (let index = 3; index < 6; index += 1) {
    if (a[index] === b[index]) {
      continue;
    }
    // A rerun (`.2`) follows the first run, which has no number.
    return (a[index] ?? 0) > (b[index] ?? 0) ? 1 : -1;
  }
  return 0;
}

const releaseSchema = z.object({
  tag_name: z.string().max(120),
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z
    .array(
      z.object({
        name: z.string().max(255),
        size: z.number().positive(),
        browser_download_url: z.string().url(),
      }),
    )
    .max(100),
});

export interface ReleaseCandidate {
  readonly version: string;
  /** Page of the release. */
  readonly url: string;
  /** Folder that contains the assets of this release, with a trailing slash. */
  readonly feedUrl: string;
  /** The installers for this platform. */
  readonly assetUrls: readonly string[];
  readonly sourceChannel: UpdateChannel;
}

/** Only pages of releases of this repository are opened in the browser. */
export function isReleasePage(url: string): boolean {
  return /^https:\/\/github\.com\/Dytschgo\/koma-motion\/releases\/tag\/v[0-9A-Za-z.-]{1,80}$/.test(
    url,
  );
}

export type UpdatePlatform = 'win32' | 'darwin';

export function toUpdatePlatform(platform: string): UpdatePlatform | null {
  return platform === 'win32' || platform === 'darwin' ? platform : null;
}

export function getManifestName(channel: UpdateChannel, platform: UpdatePlatform): string {
  const prefix = channel === 'stable' ? 'latest' : 'nightly';
  return `${prefix}${platform === 'darwin' ? '-mac' : ''}.yml`;
}

function isInstaller(name: string, platform: UpdatePlatform): boolean {
  return platform === 'darwin'
    ? name.endsWith('-mac.zip') || name.endsWith('.dmg')
    : name.endsWith('.exe');
}

/**
 * Turns one release of the GitHub API into a candidate, or `null` when it
 * does not belong to the channel or is not complete for the platform.
 */
export function selectRelease(
  value: unknown,
  channel: UpdateChannel,
  platform: UpdatePlatform,
): ReleaseCandidate | null {
  const parsed = releaseSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const release = parsed.data;
  const nightly = channel === 'nightly';
  if (release.draft || release.prerelease !== nightly || !release.tag_name.startsWith('v')) {
    return null;
  }
  const version = release.tag_name.slice(1);
  try {
    if (isNightlyRelease(version) !== nightly) {
      return null;
    }
  } catch {
    return null;
  }

  const feedUrl = `${REPOSITORY_URL}/releases/download/${release.tag_name}/`;
  // Only assets that are stored under this release count.
  const own = release.assets.filter(
    (asset) =>
      !/[\\/]/.test(asset.name) &&
      asset.browser_download_url === feedUrl + encodeURIComponent(asset.name),
  );
  const hasManifest = own.some((asset) => asset.name === getManifestName(channel, platform));
  const updateFile = platform === 'darwin' ? '-mac.zip' : '.exe';
  if (!hasManifest || !own.some((asset) => asset.name.endsWith(updateFile))) {
    return null;
  }
  return {
    version,
    url: `${REPOSITORY_URL}/releases/tag/${release.tag_name}`,
    feedUrl,
    assetUrls: own
      .filter((asset) => isInstaller(asset.name, platform))
      .map((asset) => asset.browser_download_url),
    sourceChannel: channel,
  };
}

export type Request = (url: string, options: RequestInit) => Promise<Response>;

async function readJson(request: Request, url: string, allowNotFound: boolean): Promise<unknown> {
  const response = await request(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Koma-Motion' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'error',
  });
  if (response.status === 404 && allowNotFound) {
    return null;
  }
  if (!response.ok) {
    throw new Error('Release information is not available.');
  }
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error('Release information is empty.');
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      length += value.length;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Release information is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const document: unknown = JSON.parse(new TextDecoder().decode(bytes));
  return document;
}

function isRecognisableNightly(value: unknown): string | null {
  const release = releaseSchema.safeParse(value);
  if (
    release.success &&
    !release.data.draft &&
    release.data.prerelease &&
    /^v\d+\.\d+\.\d+-nightly\./.test(release.data.tag_name)
  ) {
    return release.data.tag_name.slice(1);
  }
  return null;
}

/**
 * Finds the release to offer.
 *
 * Stable offers the latest stable release. Nightly compares the latest
 * nightly with the latest stable release and offers the newer one, so a
 * stable release is never skipped. Returns `null` when nothing has been
 * published yet. Throws when the information is unavailable or incomplete,
 * so that a failure is never reported as "up to date".
 */
export async function discoverRelease(
  channel: UpdateChannel,
  platform: UpdatePlatform,
  request: Request = fetch,
): Promise<ReleaseCandidate | null> {
  const discoverStable = async (): Promise<ReleaseCandidate | null> => {
    const value = await readJson(request, `${RELEASES_API}/latest`, true);
    if (value === null) {
      return null;
    }
    const candidate = selectRelease(value, 'stable', platform);
    if (candidate === null) {
      throw new Error('The stable release is incomplete for this platform.');
    }
    return candidate;
  };

  const stable = await discoverStable();
  if (channel === 'stable') {
    return stable;
  }

  let nightly: ReleaseCandidate | null = null;
  let reachedEnd = false;
  for (let page = 1; page <= MAX_PAGES && nightly === null; page += 1) {
    const value = await readJson(
      request,
      `${RELEASES_API}?per_page=${String(PAGE_SIZE)}&page=${String(page)}`,
      false,
    );
    if (!Array.isArray(value) || value.length > PAGE_SIZE) {
      throw new Error('The list of releases is not valid.');
    }
    for (const item of value as readonly unknown[]) {
      const candidate = selectRelease(item, 'nightly', platform);
      if (candidate !== null) {
        nightly = candidate;
        break;
      }
      const incomplete = isRecognisableNightly(item);
      if (incomplete !== null) {
        // The newest nightly is not usable. A newer stable release still is.
        if (stable !== null && compareReleaseVersions(stable.version, incomplete) > 0) {
          return stable;
        }
        throw new Error('The newest nightly is incomplete for this platform.');
      }
    }
    if (value.length < PAGE_SIZE) {
      reachedEnd = true;
      break;
    }
  }
  if (nightly === null && !reachedEnd) {
    throw new Error('No nightly was found in the recent releases.');
  }
  if (nightly === null) {
    return stable;
  }
  if (stable === null) {
    return nightly;
  }
  return compareReleaseVersions(stable.version, nightly.version) >= 0 ? stable : nightly;
}
