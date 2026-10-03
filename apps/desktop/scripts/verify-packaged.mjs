/**
 * Tests what is about to be published: it takes the files from `release/`,
 * sets the application up the way a user does and runs the tests of the
 * packaged application against it.
 *
 *   node scripts/verify-packaged.mjs <windows|macos>
 *
 * Windows: runs the installer without a window into a temporary folder and
 * removes the application again afterwards.
 * macOS: tests the update ZIP and a bundle copied from the mounted read-only
 * DMG separately, checking the signature and both architectures each time.
 *
 * KOMA_EXPECT_VERSION names the version. Without it, the version of
 * package.json is expected.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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

function runTests(executable, version, source = 'windows') {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  run(
    process.execPath,
    [
      join(root, 'node_modules/@playwright/test/cli.js'),
      'test',
      '--config',
      'playwright.packaged.config.ts',
      '--output',
      `test-results/packaged-${source}`,
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

export async function verifyMac(version, release, execute = run, testBundle = runTests) {
  const archive = requireFile(join(release, `Koma-Motion-${version}-universal-mac.zip`));
  const image = requireFile(join(release, `Koma-Motion-${version}-universal.dmg`));
  const directory = await mkdtemp(join(tmpdir(), 'koma-motion-install-'));
  const mount = join(directory, 'mounted-image');
  let mountAttempted = false;
  let safeToRemove = true;
  const verify = (bundle, source) => {
    const executable = requireFile(join(bundle, 'Contents', 'MacOS', PRODUCT));
    execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
    execute('/usr/bin/lipo', [executable, '-verify_arch', 'arm64', 'x86_64']);
    testBundle(executable, version, source);
  };
  try {
    const zipDirectory = join(directory, 'zip');
    await mkdir(zipDirectory);
    execute('/usr/bin/ditto', ['-x', '-k', archive, zipDirectory]);
    verify(join(zipDirectory, `${PRODUCT}.app`), 'zip');
    await mkdir(mount);
    mountAttempted = true;
    safeToRemove = false;
    execute('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, image]);
    const copiedBundle = join(directory, 'dmg', `${PRODUCT}.app`);
    await mkdir(join(directory, 'dmg'));
    execute('/usr/bin/ditto', [join(mount, `${PRODUCT}.app`), copiedBundle]);
    verify(copiedBundle, 'dmg');
  } finally {
    // Never recursively remove a path that could still contain a mounted filesystem.
    if (mountAttempted) {
      execute('/usr/bin/hdiutil', ['detach', mount]);
      safeToRemove = true;
    }
    if (safeToRemove) await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}

async function main() {
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
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
