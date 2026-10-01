/**
 * Tests a real update on Windows, from one published version to a newer
 * published version. It uses the network and the public releases.
 *
 *   node scripts/verify-update.mjs <installer> <channel> <expected version>
 *
 * It installs `installer` without a window into a temporary folder, starts
 * the application with updates switched on, chooses `channel`, downloads the
 * update and restarts to install it. Afterwards the tests of the packaged
 * application must confirm the expected version. The application is removed
 * again at the end.
 *
 * This is run by hand. It is no part of CI, because it depends on what is
 * published at the moment.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';
import { root } from './config.mjs';

const PRODUCT = 'Koma Motion';
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

function getEnvironment() {
  const environment = { ...process.env };
  // Tools that are built with Electron set this. It would start plain Node.js.
  delete environment.ELECTRON_RUN_AS_NODE;
  // Updates are switched off in automated runs. This run tests them.
  delete environment.KOMA_SMOKE;
  return environment;
}

function powershell(script, values = {}) {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      env: { ...process.env, ...values },
    },
  );
  return result.stdout.trim();
}

/**
 * Reads the version from the package.json inside the application. The
 * version of the executable is no use here: Windows stores four numbers, so
 * every nightly of 0.1.1 reads 0.1.1.0.
 */
function readInstalledVersion(target) {
  try {
    const archive = readFileSync(join(target, 'resources', 'app.asar'));
    const headerSize = archive.readUInt32LE(4);
    const textSize = archive.readUInt32LE(12);
    const header = JSON.parse(archive.toString('utf8', 16, 16 + textSize));
    const entry = header.files['package.json'];
    const start = 8 + headerSize + Number(entry.offset);
    return String(JSON.parse(archive.toString('utf8', start, start + entry.size)).version);
  } catch {
    // The installer is replacing the files.
    return '';
  }
}

function stopApplication(target) {
  powershell(
    'Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($env:KOMA_TARGET) } | Stop-Process -Force',
    { KOMA_TARGET: target },
  );
}

function wait(milliseconds) {
  return new Promise((done) => setTimeout(done, milliseconds));
}

async function update(executable, userData, channel, expectedVersion) {
  const application = await electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${userData}`],
    env: getEnvironment(),
  });
  const closed = new Promise((done) => application.once('close', done));
  const window = await application.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await window.getByRole('button', { name: 'Settings', exact: true }).click();
  // Versions with categorised Settings show updates on their own page. Older
  // installed versions show them directly, so the category is optional.
  const updatesPage = window
    .getByRole('navigation', { name: 'Settings categories' })
    .getByRole('button', { name: 'Updates', exact: true });
  if ((await updatesPage.count()) > 0) await updatesPage.click();
  const updates = window.getByRole('region', { name: 'App updates' });
  const status = updates.getByRole('status');
  if (channel !== 'stable') {
    await updates.getByLabel('Update channel').selectOption(channel);
    await window.getByRole('button', { name: 'Use nightly' }).click();
  } else {
    await updates.getByRole('button', { name: 'Check for updates' }).click();
  }

  const download = updates.getByRole('button', { name: 'Download update' });
  await download.waitFor({ timeout: 60_000 });
  console.log(`Found: ${await status.innerText()}`);
  const offered = await status.innerText();
  if (!offered.includes(expectedVersion)) {
    throw new Error(`Expected an offer of ${expectedVersion}, received: ${offered}`);
  }

  await download.click();
  const install = updates.getByRole('button', { name: 'Restart to install' });
  await install.waitFor({ timeout: DOWNLOAD_TIMEOUT_MS });
  console.log(`Downloaded: ${await status.innerText()}`);

  // The application quits here, so the click may not return an answer.
  await install.click({ noWaitAfter: true }).catch(() => undefined);
  await Promise.race([
    closed,
    wait(60_000).then(() => {
      throw new Error('The application did not quit to install the update.');
    }),
  ]);
  console.log('The application quit to install the update.');
}

async function waitForVersion(target, expectedVersion) {
  const end = Date.now() + INSTALL_TIMEOUT_MS;
  let version = '';
  while (Date.now() < end) {
    version = readInstalledVersion(target);
    if (version === expectedVersion) {
      return;
    }
    await wait(3000);
  }
  throw new Error(`Expected version ${expectedVersion} to be installed, found "${version}".`);
}

function runPackagedTests(executable, version) {
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/@playwright/test/cli.js'),
      'test',
      '--config',
      'playwright.packaged.config.ts',
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...getEnvironment(),
        KOMA_APP_EXECUTABLE: executable,
        KOMA_EXPECT_VERSION: version,
      },
    },
  );
  if (result.status !== 0) {
    throw new Error('The tests of the updated application failed.');
  }
}

const [installerArgument, channel, expectedVersion] = process.argv.slice(2);
if (
  process.platform !== 'win32' ||
  installerArgument === undefined ||
  (channel !== 'stable' && channel !== 'nightly') ||
  expectedVersion === undefined
) {
  throw new Error(
    'Usage on Windows: verify-update.mjs <installer> <stable|nightly> <expected version>',
  );
}

const installer = resolve(installerArgument);
// The long form of the path, the form in which Windows names running programs.
const directory = realpathSync.native(await mkdtemp(join(tmpdir(), 'koma-motion-update-')));
const target = join(directory, 'app');
const executable = join(target, `${PRODUCT}.exe`);
const uninstaller = join(target, `Uninstall ${PRODUCT}.exe`);

try {
  // `/S` installs without a window. `/D` must be last and takes no quotes.
  const installed = spawnSync(installer, ['/S', `/D=${target}`], {
    stdio: 'inherit',
    windowsVerbatimArguments: true,
  });
  if (installed.status !== 0 || !existsSync(executable)) {
    throw new Error('The installer failed.');
  }
  const before = readInstalledVersion(target);
  console.log(`Installed version ${before}.`);
  if (before === expectedVersion) {
    throw new Error('The installer already contains the expected version.');
  }

  await update(executable, join(directory, 'user-data'), channel, expectedVersion);
  await waitForVersion(target, expectedVersion);
  console.log(`The installer of the update replaced ${before} with ${expectedVersion}.`);

  // The update starts the application again. It gives the installer time to finish.
  await wait(10_000);
  stopApplication(target);
  await wait(2000);
  runPackagedTests(executable, expectedVersion);
  console.log(`The update from ${before} to ${expectedVersion} is confirmed.`);
} finally {
  stopApplication(target);
  await wait(2000);
  if (existsSync(uninstaller)) {
    spawnSync(uninstaller, ['/S'], { stdio: 'inherit' });
    await wait(5000);
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
}
