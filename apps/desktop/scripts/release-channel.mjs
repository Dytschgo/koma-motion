/**
 * Rules of the two release channels, used by the release workflows.
 *
 *   node scripts/release-channel.mjs classify-tag <tag>
 *   node scripts/release-channel.mjs nightly-version <version> <YYYYMMDD> <run id> [attempt]
 *   node scripts/release-channel.mjs validate-assets <folder> <version> <latest|nightly>
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const NUMBER = '(?:0|[1-9]\\d*)';
const STABLE_VERSION = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}$`);
export const STABLE_TAG_PATTERN = new RegExp(`^v${NUMBER}\\.${NUMBER}\\.${NUMBER}$`);
export const NIGHTLY_VERSION_PATTERN = new RegExp(
  `^${NUMBER}\\.${NUMBER}\\.${NUMBER}-nightly\\.(?:[1-9]\\d{7})\\.${NUMBER}(?:\\.${NUMBER})?$`,
);

export const UPDATE_MANIFEST_CHANNELS = ['latest', 'nightly'];

/** `stable`, `nightly` or `invalid`. */
export function classifyReleaseTag(tag) {
  if (STABLE_TAG_PATTERN.test(tag)) {
    return 'stable';
  }
  if (tag.startsWith('v') && NIGHTLY_VERSION_PATTERN.test(tag.slice(1))) {
    return 'nightly';
  }
  return 'invalid';
}

/**
 * The version of a nightly: the next patch of the stable version, the date
 * and the number of the workflow run. A repeated run adds its attempt.
 * `0.1.0` gives `0.1.1-nightly.20260929.1234`.
 */
export function nextNightlyVersion(baseVersion, date, runId, runAttempt = '1') {
  if (!STABLE_VERSION.test(baseVersion)) {
    throw new Error(`Expected a stable version, received ${baseVersion}`);
  }
  if (!/^[1-9]\d{7}$/.test(date)) {
    throw new Error(`Expected a date as YYYYMMDD, received ${date}`);
  }
  const number = new RegExp(`^${NUMBER}$`);
  if (!number.test(String(runId)) || !number.test(String(runAttempt))) {
    throw new Error('Run id and run attempt must be numbers without leading zeroes.');
  }
  const [major, minor, patch] = baseVersion.split('.').map(Number);
  const rerun = String(runAttempt) === '1' ? '' : `.${runAttempt}`;
  return `${major}.${minor}.${patch + 1}-nightly.${date}.${runId}${rerun}`;
}

/** The installers of one version, by update manifest. The first one is the update file. */
export function expectedInstallers(version, channel) {
  return {
    [`${channel}.yml`]: [`Koma-Motion-Setup-${version}.exe`],
    [`${channel}-mac.yml`]: [
      `Koma-Motion-${version}-universal-mac.zip`,
      `Koma-Motion-${version}-universal.dmg`,
    ],
  };
}

function safeAssetName(value, manifestName) {
  if (
    !value ||
    value !== basename(value) ||
    isAbsolute(value) ||
    value.includes('..') ||
    !/^[A-Za-z0-9._-]+$/.test(value)
  ) {
    throw new Error(`${manifestName} contains an unsafe file name ${value || '(empty)'}.`);
  }
  return value;
}

function scalar(line, key) {
  const match = new RegExp(`^\\s*${key}:\\s*(?:['"]([^'"]+)['"]|([^#\\r\\n]+?))\\s*$`).exec(line);
  return match?.[1] ?? match?.[2]?.trim();
}

/** Reads the fields of an update manifest that decide what is installed. */
export function parseManifest(manifest, manifestName) {
  const lines = manifest.split(/\r?\n/);
  let version;
  let path;
  let topHash;
  const entries = [];
  const seen = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('version:')) {
      version = scalar(line, 'version');
    }
    if (line.startsWith('path:')) {
      path = scalar(line, 'path');
    }
    if (line.startsWith('sha512:')) {
      topHash = scalar(line, 'sha512');
    }
    const entry = /^\s*-\s*url:\s*(?:['"]([^'"]+)['"]|([^#\r\n]+?))\s*$/.exec(line);
    if (!entry) {
      const isReference = /^\s*(?:-\s*)?url:/.test(line) || /^\s+sha512:/.test(line);
      if (isReference) {
        throw new Error(`${manifestName} contains a file entry that cannot be read.`);
      }
      continue;
    }
    const url = safeAssetName((entry[1] ?? entry[2]).trim(), manifestName);
    const hash = scalar(lines[index + 1] ?? '', 'sha512');
    if (!hash) {
      throw new Error(`${manifestName} has no sha512 for ${url}.`);
    }
    if (seen.has(url)) {
      throw new Error(`${manifestName} lists ${url} more than once.`);
    }
    seen.add(url);
    entries.push({ url, sha512: hash });
    index += 1;
  }
  if (!version || !path || !topHash || entries.length === 0) {
    throw new Error(`${manifestName} lacks required fields.`);
  }
  return { version, path: safeAssetName(path, manifestName), topHash, entries };
}

/**
 * Checks that the update manifests in a folder describe exactly the
 * installers of one version, and that every checksum matches its file.
 */
export async function validateManifestAssets(directory, version, channel) {
  if (!UPDATE_MANIFEST_CHANNELS.includes(channel)) {
    throw new Error(`Unknown update channel ${channel}.`);
  }
  const expected = expectedInstallers(version, channel);
  const names = Object.keys(expected);
  const files = await readdir(directory);
  const manifests = files.filter((file) => /\.ya?ml$/i.test(file));
  if (manifests.length !== names.length || names.some((name) => !manifests.includes(name))) {
    throw new Error(`Expected exactly the manifests ${names.join(', ')}.`);
  }

  const referenced = new Set();
  for (const manifestName of names) {
    const parsed = parseManifest(
      await readFile(resolve(directory, manifestName), 'utf8'),
      manifestName,
    );
    if (parsed.version !== version) {
      throw new Error(`${manifestName} does not describe version ${version}.`);
    }
    const allowed = expected[manifestName];
    if (
      parsed.path !== allowed[0] ||
      parsed.entries.some((entry) => !allowed.includes(entry.url))
    ) {
      throw new Error(`${manifestName} does not list the installers of version ${version}.`);
    }
    if (!parsed.entries.some((entry) => entry.url === parsed.path)) {
      throw new Error(`${manifestName} names an update file that it does not list.`);
    }
    for (const entry of parsed.entries) {
      if (referenced.has(entry.url)) {
        throw new Error(`${entry.url} is listed by more than one manifest.`);
      }
      referenced.add(entry.url);
      let actual;
      try {
        actual = createHash('sha512')
          .update(await readFile(resolve(directory, entry.url)))
          .digest('base64');
      } catch {
        throw new Error(`${manifestName} lists ${entry.url}, which is missing.`);
      }
      if (actual !== entry.sha512) {
        throw new Error(`${manifestName} has a wrong sha512 for ${entry.url}.`);
      }
      if (entry.url === parsed.path && actual !== parsed.topHash) {
        throw new Error(`${manifestName} has a wrong sha512 for its update file.`);
      }
    }
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'classify-tag') {
    const classification = classifyReleaseTag(args[0] ?? '');
    console.log(classification);
    if (classification === 'invalid') {
      process.exitCode = 1;
    }
    return;
  }
  if (command === 'nightly-version') {
    console.log(nextNightlyVersion(...args));
    return;
  }
  if (command === 'validate-assets') {
    await validateManifestAssets(args[0], args[1], args[2]);
    return;
  }
  throw new Error('Usage: release-channel.mjs classify-tag|nightly-version|validate-assets');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
