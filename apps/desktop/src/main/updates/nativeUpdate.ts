/**
 * Prepares the updater of Electron for exactly one release. The updater reads
 * a manifest from the network; nothing is downloaded unless the manifest
 * describes the release that was selected and only files of that release.
 */
import { isNightlyRelease, type ReleaseCandidate } from './releases';

/** The part of `electron-updater` that Koma Motion uses. */
export interface NativeUpdater {
  channel: string | null;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  setFeedURL(options: { provider: 'generic'; url: string; channel: string }): void;
  checkForUpdates(): Promise<{
    readonly isUpdateAvailable?: boolean;
    readonly updateInfo: {
      readonly version: string;
      readonly files: readonly { readonly url: string; readonly sha512: string }[];
      readonly path?: string;
      readonly packages?: unknown;
    };
  } | null>;
}

const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/;

export async function prepareNativeUpdate(
  updater: NativeUpdater,
  release: ReleaseCandidate,
): Promise<void> {
  const channel = isNightlyRelease(release.version) ? 'nightly' : 'stable';
  if (release.sourceChannel !== channel) {
    throw new Error('The channel of the update does not match the selected release.');
  }

  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.channel = channel === 'stable' ? 'latest' : 'nightly';
  updater.allowPrerelease = channel === 'nightly';
  // Setting the channel allows downgrades as a side effect: switch that off again.
  updater.allowDowngrade = false;
  updater.setFeedURL({ provider: 'generic', url: release.feedUrl, channel: updater.channel });

  const result = await updater.checkForUpdates();
  if (
    result === null ||
    result.isUpdateAvailable !== true ||
    result.updateInfo.version !== release.version
  ) {
    throw new Error('The update manifest does not match the selected release.');
  }

  const info = result.updateInfo;
  const belongsToRelease = (file: string): boolean => {
    const url = new URL(file, release.feedUrl).href;
    return url.startsWith(release.feedUrl) && release.assetUrls.includes(url);
  };
  const filesAreValid =
    info.files.length > 0 &&
    info.packages === undefined &&
    info.files.every((file) => belongsToRelease(file.url) && SHA512_BASE64.test(file.sha512)) &&
    (info.path === undefined || belongsToRelease(info.path));
  if (!filesAreValid) {
    throw new Error('The installer of the update is not part of the selected release.');
  }
}
