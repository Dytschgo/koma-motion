import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  classifyReleaseTag,
  nextNightlyVersion,
  parseManifest,
  validateManifestAssets,
} from './release-channel.mjs';
import { CHECKSUM_FILE, sourceAssetNames, stageReleaseAssets } from './stage-release-assets.mjs';

const NIGHTLY = '0.1.1-nightly.20260929.1234';
const scripts = dirname(fileURLToPath(import.meta.url));

function sha512(contents) {
  return createHash('sha512').update(contents).digest('base64');
}

function manifest(version, files) {
  const entries = files
    .map(([name, contents]) => `  - url: ${name}\n    sha512: ${sha512(contents)}\n    size: 1`)
    .join('\n');
  const [[first, firstContents]] = files;
  return `version: ${version}\nfiles:\n${entries}\npath: ${first}\nsha512: ${sha512(firstContents)}\nreleaseDate: '2026-09-29T12:00:00.000Z'\n`;
}

/** Writes what the packaging jobs produce for one version. */
async function writeRelease(directory, version, channel) {
  const contents = (name) => `contents of ${name}`;
  for (const name of sourceAssetNames(version, channel)) {
    if (!name.endsWith('.yml')) {
      await writeFile(join(directory, name), contents(name));
    }
  }
  const windows = `Koma-Motion-Setup-${version}.exe`;
  const zip = `Koma-Motion-${version}-universal-mac.zip`;
  const dmg = `Koma-Motion-${version}-universal.dmg`;
  await writeFile(
    join(directory, `${channel}.yml`),
    manifest(version, [[windows, contents(windows)]]),
  );
  await writeFile(
    join(directory, `${channel}-mac.yml`),
    manifest(version, [
      [zip, contents(zip)],
      [dmg, contents(dmg)],
    ]),
  );
}

async function inTemporaryFolder(run) {
  const directory = await mkdtemp(join(tmpdir(), 'koma-release-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('classifies tags', () => {
  assert.equal(classifyReleaseTag('v0.1.0'), 'stable');
  assert.equal(classifyReleaseTag('v12.30.4'), 'stable');
  assert.equal(classifyReleaseTag(`v${NIGHTLY}`), 'nightly');
  assert.equal(classifyReleaseTag(`v${NIGHTLY}.2`), 'nightly');
  for (const tag of [
    '0.1.0',
    'v0.1',
    'v00.1.0',
    'v0.1.0-beta.1',
    'v0.1.0-nightly.20260929.01234',
    'v0.1.0-nightly.2026929.1',
    'x0.1.0',
    'v0.1.0 ',
    '',
  ]) {
    assert.equal(classifyReleaseTag(tag), 'invalid', tag);
  }
});

test('derives the version of a nightly from the next patch', () => {
  assert.equal(nextNightlyVersion('0.1.0', '20260929', '1234'), NIGHTLY);
  assert.equal(nextNightlyVersion('0.1.0', '20260929', '1234', '2'), `${NIGHTLY}.2`);
  assert.equal(nextNightlyVersion('1.9.9', '20261231', '7'), '1.9.10-nightly.20261231.7');
  assert.equal(classifyReleaseTag(`v${nextNightlyVersion('0.1.0', '20260929', '1')}`), 'nightly');
  assert.throws(() => nextNightlyVersion('0.01.0', '20260929', '1234'));
  assert.throws(() => nextNightlyVersion(NIGHTLY, '20260929', '1234'));
  assert.throws(() => nextNightlyVersion('0.1.0', '2026-09-29', '1234'));
  assert.throws(() => nextNightlyVersion('0.1.0', '20260929', '01234'));
  assert.throws(() => nextNightlyVersion('0.1.0', '20260929', '1234', 'x'));
});

test('runs from the command line', () => {
  const script = join(scripts, 'release-channel.mjs');
  const stable = spawnSync(process.execPath, [script, 'classify-tag', 'v0.1.0'], {
    encoding: 'utf8',
  });
  assert.equal(stable.status, 0);
  assert.equal(stable.stdout.trim(), 'stable');

  const invalid = spawnSync(process.execPath, [script, 'classify-tag', 'v0.1'], {
    encoding: 'utf8',
  });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout.trim(), 'invalid');

  const version = spawnSync(
    process.execPath,
    [script, 'nightly-version', '0.1.0', '20260929', '1234'],
    { encoding: 'utf8' },
  );
  assert.equal(version.stdout.trim(), NIGHTLY);
});

test('reads an update manifest', () => {
  const parsed = parseManifest(manifest('0.1.0', [['a.exe', 'x']]), 'latest.yml');
  assert.deepEqual(parsed, {
    version: '0.1.0',
    path: 'a.exe',
    topHash: sha512('x'),
    entries: [{ url: 'a.exe', sha512: sha512('x') }],
  });
});

test('refuses manifests with unsafe or unreadable entries', () => {
  for (const name of ['../a.exe', '/a.exe', 'C:\\a.exe', 'a b.exe', 'https://example.com/a.exe']) {
    assert.throws(() => parseManifest(manifest('0.1.0', [[name, 'x']]), 'latest.yml'), name);
  }
  assert.throws(() => parseManifest('version: 0.1.0\n', 'latest.yml'));
  assert.throws(() =>
    parseManifest('version: 0.1.0\nfiles:\n  - url: a.exe\npath: a.exe\nsha512: x\n', 'latest.yml'),
  );
  assert.throws(() =>
    parseManifest(
      manifest('0.1.0', [
        ['a.exe', 'x'],
        ['a.exe', 'x'],
      ]),
      'latest.yml',
    ),
  );
});

test('accepts the files of a stable and of a nightly version', async () => {
  await inTemporaryFolder(async (directory) => {
    await writeRelease(directory, '0.1.0', 'latest');
    await validateManifestAssets(directory, '0.1.0', 'latest');
  });
  await inTemporaryFolder(async (directory) => {
    await writeRelease(directory, NIGHTLY, 'nightly');
    await validateManifestAssets(directory, NIGHTLY, 'nightly');
  });
});

test('refuses files that do not belong to the version', async () => {
  await inTemporaryFolder(async (directory) => {
    await writeRelease(directory, '0.1.0', 'latest');
    await assert.rejects(validateManifestAssets(directory, '0.1.1', 'latest'), /version 0\.1\.1/);
    await assert.rejects(validateManifestAssets(directory, '0.1.0', 'nightly'), /manifests/);
    await assert.rejects(validateManifestAssets(directory, '0.1.0', 'beta'), /Unknown/);
  });
});

test('refuses an installer that was changed after the manifest was written', async () => {
  await inTemporaryFolder(async (directory) => {
    await writeRelease(directory, '0.1.0', 'latest');
    await writeFile(join(directory, 'Koma-Motion-Setup-0.1.0.exe'), 'changed');
    await assert.rejects(validateManifestAssets(directory, '0.1.0', 'latest'), /wrong sha512/);
  });
});

test('refuses a manifest that lists another installer', async () => {
  await inTemporaryFolder(async (directory) => {
    await writeRelease(directory, '0.1.0', 'latest');
    await writeFile(join(directory, 'other.exe'), 'x');
    await writeFile(join(directory, 'latest.yml'), manifest('0.1.0', [['other.exe', 'x']]));
    await assert.rejects(
      validateManifestAssets(directory, '0.1.0', 'latest'),
      /does not list the installers/,
    );
  });
});

test('refuses a missing installer', async () => {
  await inTemporaryFolder(async (directory) => {
    await writeRelease(directory, '0.1.0', 'latest');
    await rm(join(directory, 'Koma-Motion-0.1.0-universal.dmg'));
    await assert.rejects(validateManifestAssets(directory, '0.1.0', 'latest'), /missing/);
  });
});

test('stages a stable release with names that have no version', async () => {
  await inTemporaryFolder(async (directory) => {
    await writeRelease(directory, '0.1.0', 'latest');
    const staged = await stageReleaseAssets(directory, '0.1.0', 'latest');

    assert.deepEqual((await readdir(directory)).sort(), [...staged].sort());
    assert.ok(staged.includes('Koma-Motion-Setup.exe'));
    assert.ok(staged.includes('Koma-Motion.dmg'));
    assert.equal(
      await readFile(join(directory, 'Koma-Motion-Setup.exe'), 'utf8'),
      await readFile(join(directory, 'Koma-Motion-Setup-0.1.0.exe'), 'utf8'),
    );

    const checksums = await readFile(join(directory, CHECKSUM_FILE), 'utf8');
    const lines = checksums.trim().split('\n');
    assert.equal(lines.length, staged.length - 1);
    for (const line of lines) {
      const [hash, name] = line.split('  ');
      const actual = createHash('sha256')
        .update(await readFile(join(directory, name)))
        .digest('hex');
      assert.equal(hash, actual, name);
    }
  });
});

test('stages a nightly without names that a link to the latest release could use', async () => {
  await inTemporaryFolder(async (directory) => {
    await writeRelease(directory, NIGHTLY, 'nightly');
    const staged = await stageReleaseAssets(directory, NIGHTLY, 'nightly');
    assert.ok(!staged.includes('Koma-Motion-Setup.exe'));
    assert.ok(!staged.includes('Koma-Motion.dmg'));
    assert.ok(staged.includes(CHECKSUM_FILE));
  });
});

test('refuses to stage when a file is missing or unexpected', async () => {
  await inTemporaryFolder(async (directory) => {
    await writeRelease(directory, '0.1.0', 'latest');
    await writeFile(join(directory, 'notes.txt'), 'x');
    await assert.rejects(
      stageReleaseAssets(directory, '0.1.0', 'latest'),
      /Unexpected: notes\.txt/,
    );
    assert.ok(!(await readdir(directory)).includes(CHECKSUM_FILE));
  });
  await inTemporaryFolder(async (directory) => {
    await writeRelease(directory, '0.1.0', 'latest');
    await rm(join(directory, 'Koma-Motion-Setup-0.1.0.exe.blockmap'));
    await assert.rejects(stageReleaseAssets(directory, '0.1.0', 'latest'), /Missing: Koma-Motion/);
  });
});
