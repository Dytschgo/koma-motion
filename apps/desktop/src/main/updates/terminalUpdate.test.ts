import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { shellQuote, terminalUpdateArguments, prepareTerminalUpdate } from './terminalUpdate';
import type { ReleaseCandidate } from './releases';

const VERSION = '0.1.1-nightly.20261002.1234';
const FEED = `https://github.com/Dytschgo/koma-motion/releases/download/v${VERSION}/`;
const candidate: ReleaseCandidate = {
  version: VERSION,
  url: `https://github.com/Dytschgo/koma-motion/releases/tag/v${VERSION}`,
  feedUrl: FEED,
  checksumUrl: `${FEED}SHA256SUMS.txt`,
  assetUrls: [`${FEED}Koma-Motion-${VERSION}-universal-mac.zip`],
  sourceChannel: 'nightly',
};

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('terminal macOS updates', () => {
  it('quotes shell values and rejects newlines', () => {
    expect(shellQuote("/Applications/Dylan's Koma Motion.app")).toBe(
      "'/Applications/Dylan'\\''s Koma Motion.app'",
    );
    expect(() => shellQuote('bad\nvalue')).toThrow();
  });

  it('binds the command to the selected nightly, checksum and installed app', () => {
    expect(terminalUpdateArguments(candidate, '/Applications/Koma Motion.app', '0.1.0')).toEqual([
      `v${VERSION}`,
      `${FEED}Koma-Motion-${VERSION}-universal-mac.zip`,
      `${FEED}SHA256SUMS.txt`,
      '/Applications/Koma Motion.app',
      '0.1.0',
    ]);
    expect(() =>
      terminalUpdateArguments(
        { ...candidate, checksumUrl: 'https://example.com/SHA256SUMS.txt' },
        '/Applications/Koma Motion.app',
        '0.1.0',
      ),
    ).toThrow('checksum');
    expect(() =>
      terminalUpdateArguments(candidate, '/Applications/Koma Motion', '0.1.0'),
    ).toThrow();
  });

  it('writes a launcher with fixed shell-quoted release arguments and a copyable command', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'koma-terminal-update-test-'));
    temporaryDirectories.push(directory);
    const helper = join(directory, 'update-macos.sh');
    await writeFile(helper, '#!/bin/bash\nexit 0\n');

    const prepared = await prepareTerminalUpdate(
      candidate,
      "/Applications/Dylan's Apps/Koma Motion.app",
      helper,
      directory,
      '0.1.0',
    );
    const commandPath = prepared.command.slice("/bin/bash '".length, -1);
    const launcher = await readFile(commandPath, 'utf8');
    expect(launcher).toContain("Dylan'\\''s Apps/Koma Motion.app");
    expect(launcher).toContain(`'v${VERSION}'`);
    expect(launcher).toContain(`${FEED}SHA256SUMS.txt`);
    expect(launcher).toContain('Press Return to close this window');
  });
});
