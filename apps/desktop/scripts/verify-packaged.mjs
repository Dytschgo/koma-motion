/**
 * Tests what is about to be published: it takes the files from `release/`,
 * sets the application up the way a user does and runs the tests of the
 * packaged application against it.
 *
 *   node scripts/verify-packaged.mjs <windows|macos>
 *
 * Windows: runs the installer without a window into a temporary folder and
 * removes the application again afterwards.
 * macOS: unpacks the archive that updates use, checks the signature and both
 * architectures.
 *
 * KOMA_EXPECT_VERSION names the version. Without it, the version of
 * package.json is expected.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { classifyReleaseTag } from './release-channel.mjs';
import { root } from './config.mjs';

const PRODUCT = 'Koma Motion';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ended with exit code ${result.status ?? 'unknown'}.`);
  }
}

async function readExpectedVersion() {
  const version =
    process.env.KOMA_EXPECT_VERSION ??
    JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
  if (classifyReleaseTag(`v${version}`) === 'invalid') {
    throw new Error(`Expected a stable or nightly version, received ${version}.`);
  }
  return version;
}

function requireFile(path) {
  if (!existsSync(path)) {
    throw new Error(`Expected ${path}, which does not exist.`);
  }
  return path;
}

function runTests(executable, version) {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  run(
    process.execPath,
    [
      join(root, 'node_modules/@playwright/test/cli.js'),
      'test',
      '--config',
      'playwright.packaged.config.ts',
    ],
    {
      cwd: root,
      env: {
        ...environment,
        KOMA_APP_EXECUTABLE: requireFile(executable),
        KOMA_EXPECT_VERSION: version,
      },
    },
  );
}

async function verifyWindows(version, release) {
  const installer = requireFile(join(release, `Koma-Motion-Setup-${version}.exe`));
  const directory = await mkdtemp(join(tmpdir(), 'koma-motion-install-'));
  const target = join(directory, 'app');
  const uninstaller = join(target, `Uninstall ${PRODUCT}.exe`);
  try {
    // `/S` installs without a window. `/D` must be last and takes no quotes.
    run(installer, ['/S', `/D=${target}`], { windowsVerbatimArguments: true });
    runTests(join(target, `${PRODUCT}.exe`), version);
  } finally {
    if (existsSync(uninstaller)) {
      spawnSync(uninstaller, ['/S'], { stdio: 'inherit' });
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  }
}

async function verifyMac(version, release) {
  const archive = requireFile(join(release, `Koma-Motion-${version}-universal-mac.zip`));
  requireFile(join(release, `Koma-Motion-${version}-universal.dmg`));
  const directory = await mkdtemp(join(tmpdir(), 'koma-motion-install-'));
  const bundle = join(directory, `${PRODUCT}.app`);
  const executable = join(bundle, 'Contents', 'MacOS', PRODUCT);
  try {
    run('/usr/bin/ditto', ['-x', '-k', archive, directory]);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
    run('/usr/bin/lipo', [executable, '-verify_arch', 'arm64', 'x86_64']);
    runTests(executable, version);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  }
}

const platform = process.argv[2];
const release = resolve(root, process.argv[3] ?? 'release');
const version = await readExpectedVersion();

if (platform === 'windows') {
  await verifyWindows(version, release);
} else if (platform === 'macos') {
  await verifyMac(version, release);
} else {
  throw new Error('Usage: verify-packaged.mjs <windows|macos> [folder]');
}
console.log(`The packaged application confirmed version ${version}.`);
