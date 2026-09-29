import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '../../shared/updates';
import { prepareNativeUpdate, type NativeUpdater } from './nativeUpdate';
import { DEFAULT_PREFERENCES, readPreferences, writePreferences } from './preferences';
import {
  compareReleaseVersions,
  discoverRelease,
  getManifestName,
  isReleasePage,
  parseReleaseVersion,
  selectRelease,
  type ReleaseCandidate,
  type Request,
} from './releases';
import { UpdateController, type UpdateOperations } from './updateController';

const DOWNLOADS = 'https://github.com/Dytschgo/koma-motion/releases/download';
const NIGHTLY = '0.1.1-nightly.20260929.1234';
const HASH = `${'A'.repeat(86)}==`;

function release(
  version: string,
  options: { prerelease?: boolean; draft?: boolean; assets?: readonly string[] } = {},
): Record<string, unknown> {
  const nightly = version.includes('-nightly.');
  const manifest = nightly ? 'nightly' : 'latest';
  const names = options.assets ?? [
    `Koma-Motion-Setup-${version}.exe`,
    `Koma-Motion-Setup-${version}.exe.blockmap`,
    `Koma-Motion-${version}-universal-mac.zip`,
    `Koma-Motion-${version}-universal.dmg`,
    `${manifest}.yml`,
    `${manifest}-mac.yml`,
    'SHA256SUMS.txt',
  ];
  return {
    tag_name: `v${version}`,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? nightly,
    assets: names.map((name) => ({
      name,
      size: 10,
      browser_download_url: `${DOWNLOADS}/v${version}/${name}`,
    })),
  };
}

/** Answers requests for the latest release and for the list of releases. */
function github(latest: unknown, list: readonly unknown[]): Request {
  return (url) => {
    const body = url.endsWith('/latest') ? latest : list;
    return Promise.resolve(
      body === null
        ? new Response('{}', { status: 404 })
        : new Response(JSON.stringify(body), { status: 200 }),
    );
  };
}

describe('release versions', () => {
  it.each([
    ['0.1.0', '0.1.0', 0],
    ['0.2.0', '0.1.9', 1],
    ['0.1.9', '0.2.0', -1],
    ['1.0.0', '0.99.99', 1],
    ['0.1.1', NIGHTLY, 1],
    [NIGHTLY, '0.1.0', 1],
    [NIGHTLY, '0.1.1', -1],
    ['0.1.1-nightly.20260930.1', '0.1.1-nightly.20260929.9', 1],
    ['0.1.1-nightly.20260929.1235', NIGHTLY, 1],
    [`${NIGHTLY}.2`, NIGHTLY, 1],
    [NIGHTLY, `${NIGHTLY}.2`, -1],
  ])('compares %s with %s', (left, right, expected) => {
    expect(compareReleaseVersions(left, right)).toBe(expected);
  });

  it.each(['1.0', 'v1.0.0', '1.0.0-beta.1', '01.0.0', '1.0.0-nightly.2026.1', '', '1.0.0 '])(
    'rejects "%s"',
    (version) => {
      expect(() => parseReleaseVersion(version)).toThrow();
    },
  );
});

describe('selectRelease', () => {
  it('selects a complete stable release for Windows and macOS', () => {
    expect(selectRelease(release('0.1.0'), 'stable', 'win32')).toEqual({
      version: '0.1.0',
      url: 'https://github.com/Dytschgo/koma-motion/releases/tag/v0.1.0',
      feedUrl: `${DOWNLOADS}/v0.1.0/`,
      assetUrls: [`${DOWNLOADS}/v0.1.0/Koma-Motion-Setup-0.1.0.exe`],
      sourceChannel: 'stable',
    });
    expect(selectRelease(release('0.1.0'), 'stable', 'darwin')?.assetUrls).toEqual([
      `${DOWNLOADS}/v0.1.0/Koma-Motion-0.1.0-universal-mac.zip`,
      `${DOWNLOADS}/v0.1.0/Koma-Motion-0.1.0-universal.dmg`,
    ]);
  });

  it('keeps the channels apart', () => {
    expect(selectRelease(release(NIGHTLY), 'stable', 'win32')).toBeNull();
    expect(selectRelease(release('0.1.0'), 'nightly', 'win32')).toBeNull();
    expect(selectRelease(release(NIGHTLY), 'nightly', 'win32')?.sourceChannel).toBe('nightly');
    // A nightly version that is not marked as a prerelease, and the other way round.
    expect(selectRelease(release(NIGHTLY, { prerelease: false }), 'nightly', 'win32')).toBeNull();
    expect(selectRelease(release('0.1.0', { prerelease: true }), 'stable', 'win32')).toBeNull();
  });

  it('ignores drafts and releases without an installer or a manifest', () => {
    expect(selectRelease(release('0.1.0', { draft: true }), 'stable', 'win32')).toBeNull();
    expect(
      selectRelease(release('0.1.0', { assets: ['latest.yml'] }), 'stable', 'win32'),
    ).toBeNull();
    expect(
      selectRelease(
        release('0.1.0', { assets: ['Koma-Motion-Setup-0.1.0.exe'] }),
        'stable',
        'win32',
      ),
    ).toBeNull();
    expect(
      selectRelease(
        release('0.1.0', { assets: ['Koma-Motion-Setup-0.1.0.exe', 'latest.yml'] }),
        'stable',
        'darwin',
      ),
    ).toBeNull();
  });

  it('ignores assets that are stored somewhere else', () => {
    const foreign = release('0.1.0');
    foreign['assets'] = [
      {
        name: 'Koma-Motion-Setup-0.1.0.exe',
        size: 10,
        browser_download_url: 'https://example.com/Koma-Motion-Setup-0.1.0.exe',
      },
      { name: 'latest.yml', size: 10, browser_download_url: `${DOWNLOADS}/v0.1.0/latest.yml` },
    ];
    expect(selectRelease(foreign, 'stable', 'win32')).toBeNull();
  });

  it.each([null, 'text', 42, [], {}, { tag_name: 'v0.1.0' }])('ignores %o', (value) => {
    expect(selectRelease(value, 'stable', 'win32')).toBeNull();
  });

  it('names the manifest of each channel and platform', () => {
    expect(getManifestName('stable', 'win32')).toBe('latest.yml');
    expect(getManifestName('stable', 'darwin')).toBe('latest-mac.yml');
    expect(getManifestName('nightly', 'win32')).toBe('nightly.yml');
    expect(getManifestName('nightly', 'darwin')).toBe('nightly-mac.yml');
  });
});

describe('discoverRelease', () => {
  it('offers the latest stable release on the stable channel', async () => {
    const found = await discoverRelease(
      'stable',
      'win32',
      github(release('0.1.0'), [release(NIGHTLY), release('0.1.0')]),
    );
    expect(found?.version).toBe('0.1.0');
  });

  it('offers nothing before the first release', async () => {
    expect(await discoverRelease('stable', 'win32', github(null, []))).toBeNull();
    expect(await discoverRelease('nightly', 'win32', github(null, []))).toBeNull();
  });

  it('offers the newer of nightly and stable on the nightly channel', async () => {
    const nightlyIsNewer = await discoverRelease(
      'nightly',
      'win32',
      github(release('0.1.0'), [release(NIGHTLY), release('0.1.0')]),
    );
    expect(nightlyIsNewer).toMatchObject({ version: NIGHTLY, sourceChannel: 'nightly' });

    const stableIsNewer = await discoverRelease(
      'nightly',
      'win32',
      github(release('0.1.1'), [release('0.1.1'), release(NIGHTLY)]),
    );
    expect(stableIsNewer).toMatchObject({ version: '0.1.1', sourceChannel: 'stable' });
  });

  it('offers a nightly before the first stable release', async () => {
    const found = await discoverRelease('nightly', 'win32', github(null, [release(NIGHTLY)]));
    expect(found?.version).toBe(NIGHTLY);
  });

  it('fails instead of reporting "up to date" when the newest nightly is incomplete', async () => {
    const incomplete = release('0.1.1-nightly.20260930.5', { assets: ['nightly.yml'] });
    await expect(
      discoverRelease('nightly', 'win32', github(release('0.1.0'), [incomplete, release(NIGHTLY)])),
    ).rejects.toThrow('incomplete');
  });

  it('fails when release information is unavailable, too large or not JSON', async () => {
    await expect(
      discoverRelease('stable', 'win32', () => Promise.resolve(new Response('', { status: 500 }))),
    ).rejects.toThrow();
    await expect(
      discoverRelease('stable', 'win32', () =>
        Promise.resolve(new Response('x'.repeat(4_000_001), { status: 200 })),
      ),
    ).rejects.toThrow('too large');
    await expect(
      discoverRelease('stable', 'win32', () =>
        Promise.resolve(new Response('<html>', { status: 200 })),
      ),
    ).rejects.toThrow();
    await expect(
      discoverRelease('stable', 'win32', () => Promise.reject(new Error('offline'))),
    ).rejects.toThrow();
  });

  it('asks GitHub only, without following redirects', async () => {
    const urls: string[] = [];
    const redirects: (string | undefined)[] = [];
    await discoverRelease('nightly', 'win32', (url, options) => {
      urls.push(url);
      redirects.push(options.redirect);
      return github(release('0.1.0'), [release(NIGHTLY)])(url, options);
    });
    expect(urls).toEqual([
      'https://api.github.com/repos/Dytschgo/koma-motion/releases/latest',
      'https://api.github.com/repos/Dytschgo/koma-motion/releases?per_page=100&page=1',
    ]);
    expect(redirects).toEqual(['error', 'error']);
  });
});

describe('isReleasePage', () => {
  it('accepts pages of releases of this repository', () => {
    expect(isReleasePage('https://github.com/Dytschgo/koma-motion/releases/tag/v0.1.0')).toBe(true);
    expect(isReleasePage(`https://github.com/Dytschgo/koma-motion/releases/tag/v${NIGHTLY}`)).toBe(
      true,
    );
  });

  it.each([
    'https://github.com/Dytschgo/koma-motion-evil/releases/tag/v0.1.0',
    'https://github.com/Someone/koma-motion/releases/tag/v0.1.0',
    'https://github.com/Dytschgo/koma-motion/releases/tag/v0.1.0/../../../settings',
    'https://github.com/Dytschgo/koma-motion/releases/tag/v0.1.0?x=1',
    'http://github.com/Dytschgo/koma-motion/releases/tag/v0.1.0',
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
  ])('refuses %s', (url) => {
    expect(isReleasePage(url)).toBe(false);
  });
});

describe('prepareNativeUpdate', () => {
  const candidate: ReleaseCandidate = {
    version: NIGHTLY,
    url: `https://github.com/Dytschgo/koma-motion/releases/tag/v${NIGHTLY}`,
    feedUrl: `${DOWNLOADS}/v${NIGHTLY}/`,
    assetUrls: [`${DOWNLOADS}/v${NIGHTLY}/Koma-Motion-Setup-${NIGHTLY}.exe`],
    sourceChannel: 'nightly',
  };

  function updater(
    info: Partial<NonNullable<Awaited<ReturnType<NativeUpdater['checkForUpdates']>>>['updateInfo']>,
    available = true,
  ): NativeUpdater & { feed: unknown } {
    return {
      channel: null,
      allowPrerelease: false,
      allowDowngrade: true,
      autoDownload: true,
      autoInstallOnAppQuit: true,
      feed: null,
      setFeedURL(options) {
        this.feed = options;
      },
      checkForUpdates: () =>
        Promise.resolve({
          isUpdateAvailable: available,
          updateInfo: {
            version: NIGHTLY,
            files: [{ url: `Koma-Motion-Setup-${NIGHTLY}.exe`, sha512: HASH }],
            ...info,
          },
        }),
    };
  }

  it('points the updater at the selected release and nothing else', async () => {
    const native = updater({});
    await prepareNativeUpdate(native, candidate);
    expect(native).toMatchObject({
      channel: 'nightly',
      allowPrerelease: true,
      allowDowngrade: false,
      autoDownload: false,
      autoInstallOnAppQuit: false,
      feed: { provider: 'generic', url: candidate.feedUrl, channel: 'nightly' },
    });
  });

  it.each([
    ['another version', { version: '9.9.9' }],
    ['a file of another release', { files: [{ url: `${DOWNLOADS}/v9.9.9/x.exe`, sha512: HASH }] }],
    ['a file on another server', { files: [{ url: 'https://example.com/x.exe', sha512: HASH }] }],
    [
      'a file without a valid checksum',
      { files: [{ url: `Koma-Motion-Setup-${NIGHTLY}.exe`, sha512: 'x' }] },
    ],
    ['no files', { files: [] }],
    ['a path outside the release', { path: '../v9.9.9/x.exe' }],
    ['additional packages', { packages: {} }],
  ])('refuses a manifest with %s', async (_label, info) => {
    await expect(prepareNativeUpdate(updater(info), candidate)).rejects.toThrow();
  });

  it('refuses when the updater reports no update', async () => {
    await expect(prepareNativeUpdate(updater({}, false), candidate)).rejects.toThrow();
  });

  it('refuses a release whose channel does not match its version', async () => {
    await expect(
      prepareNativeUpdate(updater({}), { ...candidate, sourceChannel: 'stable' }),
    ).rejects.toThrow('channel');
  });
});

describe('UpdateController', () => {
  const stable: ReleaseCandidate = {
    version: '0.2.0',
    url: 'https://github.com/Dytschgo/koma-motion/releases/tag/v0.2.0',
    feedUrl: `${DOWNLOADS}/v0.2.0/`,
    assetUrls: [`${DOWNLOADS}/v0.2.0/Koma-Motion-Setup-0.2.0.exe`],
    sourceChannel: 'stable',
  };

  function setup(overrides: Partial<UpdateOperations> = {}): {
    controller: UpdateController;
    ops: { [K in keyof UpdateOperations]: UpdateOperations[K] };
    states: () => string[];
    last: () => UpdateStatus;
  } {
    const emitted: UpdateStatus[] = [];
    const ops = {
      currentVersion: '0.1.0',
      enabled: true,
      manual: false,
      discover: vi.fn(() => Promise.resolve<ReleaseCandidate | null>(stable)),
      prepare: vi.fn(() => Promise.resolve()),
      download: vi.fn(() => Promise.resolve()),
      install: vi.fn(() => undefined),
      open: vi.fn(() => Promise.resolve()),
      emit: (status: UpdateStatus) => {
        emitted.push(status);
      },
      ...overrides,
    };
    const controller = new UpdateController('stable', ops);
    return {
      controller,
      ops,
      states: () => emitted.map((status) => status.state),
      last: () => controller.getStatus(),
    };
  }

  it('finds, downloads and installs an update only when asked', async () => {
    const { controller, ops, states, last } = setup();

    await controller.check();
    expect(last()).toMatchObject({ state: 'available', version: '0.2.0', manualDownload: false });
    expect(ops.prepare).toHaveBeenCalledWith(stable);
    expect(ops.download).not.toHaveBeenCalled();

    await controller.download();
    expect(last()).toMatchObject({ state: 'downloaded', percent: 100 });
    expect(ops.install).not.toHaveBeenCalled();

    await controller.install();
    expect(ops.install).toHaveBeenCalledTimes(1);
    expect(states()).toEqual(['checking', 'available', 'downloading', 'downloaded', 'downloaded']);
  });

  it('reports the latest version and never offers an older one', async () => {
    const same = setup({ currentVersion: '0.2.0' });
    await same.controller.check();
    expect(same.last()).toMatchObject({
      state: 'not-available',
      message: 'You have the latest stable version.',
    });

    const newer = setup({ currentVersion: '0.3.0' });
    await newer.controller.check();
    expect(newer.last().state).toBe('not-available');
    expect(newer.last().message).toContain('never installs an older version');
    expect(newer.ops.prepare).not.toHaveBeenCalled();
    await expect(newer.controller.install()).rejects.toThrow();
  });

  it('reports that nothing has been published', async () => {
    const { controller, last } = setup({ discover: () => Promise.resolve(null) });
    await controller.check();
    expect(last()).toMatchObject({
      state: 'not-available',
      message: 'No stable version has been published yet.',
    });
  });

  it('opens the page of the release when the build cannot install updates', async () => {
    const { controller, ops, last } = setup({ manual: true });
    await controller.check();
    expect(last()).toMatchObject({ state: 'available', manualDownload: true });
    expect(ops.prepare).not.toHaveBeenCalled();

    await controller.download();
    expect(ops.open).toHaveBeenCalledWith(stable.url);
    expect(ops.download).not.toHaveBeenCalled();
    expect(last().state).toBe('available');
  });

  it('does nothing in a build that is not installed', async () => {
    const { controller, ops, last } = setup({ enabled: false });
    await controller.check();
    expect(ops.discover).not.toHaveBeenCalled();
    expect(last()).toMatchObject({ state: 'idle' });
    expect(last().message).toContain('installed versions');

    await controller.check({ background: true });
    expect(ops.discover).not.toHaveBeenCalled();
  });

  it('reports a failed check and allows another one', async () => {
    const discover = vi
      .fn<UpdateOperations['discover']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(stable);
    const { controller, last } = setup({ discover });

    await controller.check();
    expect(last().state).toBe('error');
    expect(last().message).toContain('Your projects are unchanged');
    expect(JSON.stringify(last())).not.toContain('offline');

    await controller.check();
    expect(last().state).toBe('available');
  });

  it('keeps an update that was found when a background check fails', async () => {
    const discover = vi
      .fn<UpdateOperations['discover']>()
      .mockResolvedValueOnce(stable)
      .mockRejectedValueOnce(new Error('offline'));
    const { controller, states, last } = setup({ discover });

    await controller.check();
    await controller.check({ background: true });

    expect(last()).toMatchObject({ state: 'available', version: '0.2.0' });
    expect(states()).toEqual(['checking', 'available']);
  });

  it('reports a failed download', async () => {
    const { controller, last } = setup({ download: () => Promise.reject(new Error('disk full')) });
    await controller.check();
    await controller.download();
    expect(last().state).toBe('error');
    await expect(controller.download()).rejects.toThrow('no update');
  });

  it('reports the progress of a download', async () => {
    let finish: () => void = () => undefined;
    const { controller, last } = setup({
      download: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    await controller.check();
    const pending = controller.download();
    await Promise.resolve();

    controller.progress(41.5);
    expect(last()).toMatchObject({ state: 'downloading', percent: 41.5 });
    controller.progress(250);
    expect(last().percent).toBe(100);
    controller.progress(Number.NaN);
    expect(last().percent).toBe(100);

    finish();
    await pending;
    controller.progress(10);
    expect(last()).toMatchObject({ state: 'downloaded', percent: 100 });
  });

  it('changes the channel only after the choice was stored', async () => {
    const { controller, ops, last } = setup();
    const persist = vi.fn(() => Promise.resolve());

    await controller.switchChannel('nightly', persist);
    await controller.check();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(last().channel).toBe('nightly');
    expect(ops.discover).toHaveBeenLastCalledWith('nightly');

    await expect(
      setup().controller.switchChannel('nightly', () => Promise.reject(new Error('read-only'))),
    ).rejects.toThrow();
  });

  it('keeps the channel when the choice cannot be stored', async () => {
    const { controller, last } = setup();
    await controller
      .switchChannel('nightly', () => Promise.reject(new Error('read-only')))
      .catch(() => undefined);
    expect(last().channel).toBe('stable');
  });

  it('does not change the channel during a check, a download or before installing', async () => {
    const { controller } = setup();
    const persist = vi.fn(() => Promise.resolve());

    const pending = controller.check();
    await expect(controller.switchChannel('nightly', persist)).rejects.toThrow('Finish');
    await pending;

    await controller.download();
    await expect(controller.switchChannel('nightly', persist)).rejects.toThrow('Finish');
    expect(persist).not.toHaveBeenCalled();
  });

  it('explains a stable release that is newer than the latest nightly', async () => {
    const { controller, last } = setup();
    await controller.switchChannel('nightly', () => Promise.resolve());
    await controller.check();
    expect(last()).toMatchObject({
      state: 'available',
      channel: 'nightly',
      sourceChannel: 'stable',
    });
    expect(last().message).toBe(
      'Stable 0.2.0 is newer than the latest nightly. Nightly stays selected.',
    );
  });

  it('reports an installation that did not start', async () => {
    const { controller, last } = setup({
      install: () => {
        throw new Error('locked');
      },
    });
    await controller.check();
    await controller.download();
    await expect(controller.install()).rejects.toThrow('could not be installed');
    expect(last()).toMatchObject({ state: 'downloaded', installing: false });
  });
});

describe('preferences', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'koma-preferences-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('uses the stable channel by default', async () => {
    expect(await readPreferences(directory)).toEqual(DEFAULT_PREFERENCES);
    expect(DEFAULT_PREFERENCES.updateChannel).toBe('stable');
  });

  it('stores and reads the channel', async () => {
    await writePreferences(directory, { updateChannel: 'nightly' });
    expect(await readPreferences(directory)).toEqual({ updateChannel: 'nightly' });
    expect(JSON.parse(await readFile(join(directory, 'preferences.json'), 'utf8'))).toEqual({
      updateChannel: 'nightly',
    });
  });

  it.each([
    ['damaged text', '{ "updateChannel": '],
    ['an unknown channel', '{"updateChannel":"beta"}'],
    ['another document', '[1,2,3]'],
    ['a very large file', `{"updateChannel":"nightly","x":"${'x'.repeat(20_000)}"}`],
  ])('falls back to stable for %s', async (_label, text) => {
    await writeFile(join(directory, 'preferences.json'), text, 'utf8');
    expect(await readPreferences(directory)).toEqual(DEFAULT_PREFERENCES);
  });
});
