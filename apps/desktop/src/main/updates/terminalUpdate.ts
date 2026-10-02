/** Prepares a shell command that installs one verified macOS release. */
import { copyFile, chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { REPOSITORY_URL, parseReleaseVersion, type ReleaseCandidate } from './releases';

const execute = promisify(execFile);

export function shellQuote(value: string): string {
  if (/[\0\r\n]/.test(value)) {
    throw new Error('The update command contains an unsupported value.');
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function terminalUpdateArguments(
  release: ReleaseCandidate,
  appPath: string,
  currentVersion: string,
): string[] {
  parseReleaseVersion(release.version);
  parseReleaseVersion(currentVersion);
  const tag = `v${release.version}`;
  const base = `${REPOSITORY_URL}/releases/download/${tag}/`;
  const filename = `Koma-Motion-${release.version}-universal-mac.zip`;
  const archive = base + filename;
  if (release.feedUrl !== base || !release.assetUrls.includes(archive)) {
    throw new Error('The selected release has no supported macOS update archive.');
  }
  if (release.checksumUrl !== `${base}SHA256SUMS.txt`) {
    throw new Error('The selected release has no checksum file. Check for updates again.');
  }
  if (!posix.isAbsolute(appPath) || !appPath.endsWith('/Koma Motion.app')) {
    throw new Error('Run Koma Motion from an installed app before updating.');
  }
  return [tag, archive, release.checksumUrl, appPath, currentVersion];
}

export async function prepareTerminalUpdate(
  release: ReleaseCandidate,
  appPath: string,
  helperPath: string,
  temporaryDirectory: string,
  currentVersion: string,
): Promise<{ command: string; run: () => Promise<void> }> {
  const args = terminalUpdateArguments(release, appPath, currentVersion);
  const directory = await mkdtemp(join(temporaryDirectory, 'koma-motion-update-'));
  const helper = join(directory, 'update-macos.sh');
  const launcher = join(directory, 'Run Koma Motion update.command');
  await copyFile(helperPath, helper);
  await chmod(helper, 0o700);
  const script = `#!/bin/bash\n/bin/bash ${[helper, ...args].map(shellQuote).join(' ')}\nresult=$?\nif [ "$result" -ne 0 ]; then\n  printf '\\nUpdate stopped. Press Return to close this window.'\n  read -r _\nfi\n/bin/rm -rf ${shellQuote(directory)}\nexit "$result"\n`;
  await writeFile(launcher, script, { mode: 0o700 });
  return {
    command: `/bin/bash ${shellQuote(launcher)}`,
    run: async () => {
      await execute('/usr/bin/open', ['-a', 'Terminal', launcher]);
    },
  };
}
