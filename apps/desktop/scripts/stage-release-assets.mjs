/**
 * Prepares the files of a release for publication. The folder must contain
 * exactly the files of one version: anything missing or unexpected stops the
 * release. Checksums are written last, over the files that are published.
 *
 *   node scripts/stage-release-assets.mjs <folder> <version> <latest|nightly>
 */
import { createHash } from 'node:crypto';
import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { UPDATE_MANIFEST_CHANNELS, validateManifestAssets } from './release-channel.mjs';

export const CHECKSUM_FILE = 'SHA256SUMS.txt';

/** What the packaging jobs produce for one version. */
export function sourceAssetNames(version, channel) {
  return [
    `Koma-Motion-Setup-${version}.exe`,
    `Koma-Motion-Setup-${version}.exe.blockmap`,
    `Koma-Motion-${version}-universal-mac.zip`,
    `Koma-Motion-${version}-universal-mac.zip.blockmap`,
    `Koma-Motion-${version}-universal.dmg`,
    `Koma-Motion-${version}-universal.dmg.blockmap`,
    `${channel}.yml`,
    `${channel}-mac.yml`,
  ];
}

/**
 * Names without a version, so that a link to the latest stable release keeps
 * working: `releases/latest/download/Koma-Motion-Setup.exe`.
 */
export function aliases(version) {
  return [
    [`Koma-Motion-Setup-${version}.exe`, 'Koma-Motion-Setup.exe'],
    [`Koma-Motion-${version}-universal.dmg`, 'Koma-Motion.dmg'],
  ];
}

function assertExactFiles(actual, expected, label) {
  const unexpected = actual.filter((file) => !expected.includes(file));
  const missing = expected.filter((file) => !actual.includes(file));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      `${label} do not match. Missing: ${missing.join(', ') || 'none'}. Unexpected: ${unexpected.join(', ') || 'none'}.`,
    );
  }
}

export async function stageReleaseAssets(directory, version, channel) {
  if (!UPDATE_MANIFEST_CHANNELS.includes(channel)) {
    throw new Error(`Unknown update channel ${channel}.`);
  }
  const source = sourceAssetNames(version, channel);
  assertExactFiles(await readdir(directory), source, 'The files of the packaging jobs');
  await validateManifestAssets(directory, version, channel);

  // Only stable releases get names without a version. A nightly must never
  // be what a link to the latest release downloads.
  const copies = channel === 'latest' ? aliases(version) : [];
  for (const [from, to] of copies) {
    await copyFile(resolve(directory, from), resolve(directory, to));
  }
  const staged = [...source, ...copies.map(([, to]) => to)];
  assertExactFiles(await readdir(directory), staged, 'The staged files');

  const checksums = [];
  for (const file of [...staged].sort()) {
    const hash = createHash('sha256')
      .update(await readFile(resolve(directory, file)))
      .digest('hex');
    checksums.push(`${hash}  ${file}`);
  }
  await writeFile(resolve(directory, CHECKSUM_FILE), `${checksums.join('\n')}\n`);
  return [...staged, CHECKSUM_FILE];
}

async function main() {
  const [directory, version, channel] = process.argv.slice(2);
  if (!directory || !version || !UPDATE_MANIFEST_CHANNELS.includes(channel)) {
    throw new Error('Usage: stage-release-assets.mjs <folder> <version> <latest|nightly>');
  }
  const staged = await stageReleaseAssets(directory, version, channel);
  console.log(`Staged ${staged.length} files of version ${version}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
