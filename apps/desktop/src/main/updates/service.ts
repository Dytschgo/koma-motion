/**
 * Connects the update controller with Electron: the native updater, the
 * stored preference and the browser for manual downloads.
 *
 * This is the only part of the application that uses the network by itself.
 * It contacts GitHub, reads release information and downloads an installer
 * when the user asks for it. It sends nothing about the user or a project.
 */
import { app, clipboard, shell } from 'electron';
import { join, resolve } from 'node:path';
import electronUpdater from 'electron-updater';
import type { UpdateChannel, UpdateStatus } from '../../shared/updates';
import { prepareNativeUpdate } from './nativeUpdate';
import { readPreferences, writePreferences } from './preferences';
import { discoverRelease, isReleasePage, toUpdatePlatform } from './releases';
import { UpdateController } from './updateController';
import { prepareTerminalUpdate } from './terminalUpdate';

const STARTUP_CHECK_DELAY_MS = 20_000;
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export interface UpdateService {
  getStatus(): UpdateStatus;
  check(): Promise<void>;
  setChannel(channel: UpdateChannel): Promise<UpdateStatus>;
  download(): Promise<void>;
  install(): Promise<void>;
  copyCommand(): Promise<void>;
  dispose(): void;
}

/** `KOMA_SMOKE=1` marks automated runs of a packaged build, which must not use the network. */
function isAutomatedRun(): boolean {
  return process.env['KOMA_SMOKE'] === '1';
}

export async function createUpdateService(
  emit: (status: UpdateStatus) => void,
): Promise<UpdateService> {
  const { autoUpdater } = electronUpdater;
  const directory = app.getPath('userData');
  const platform = toUpdatePlatform(process.platform);
  const enabled = app.isPackaged && platform !== null && !isAutomatedRun();
  let preferences = await readPreferences(directory);

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = null;

  const controller = new UpdateController(preferences.updateChannel, {
    currentVersion: app.getVersion(),
    enabled,
    // macOS updates use a checksum and bundle-verified Terminal installer;
    // electron-updater remains responsible for Windows updates.
    manual: platform !== 'win32',
    discover: (channel) =>
      platform === null ? Promise.resolve(null) : discoverRelease(channel, platform),
    prepare: (release) => prepareNativeUpdate(autoUpdater, release),
    ...(platform === 'darwin'
      ? {
          prepareTerminal: (release: Parameters<typeof prepareTerminalUpdate>[0]) =>
            prepareTerminalUpdate(
              release,
              resolve(app.getPath('exe'), '../../..'),
              join(app.getAppPath(), 'scripts/update-macos.sh'),
              app.getPath('temp'),
              app.getVersion(),
            ),
        }
      : {}),
    download: () => autoUpdater.downloadUpdate(),
    install: () => {
      autoUpdater.quitAndInstall(true, true);
    },
    open: async (url) => {
      if (!isReleasePage(url)) {
        throw new Error('The page of the release is not valid.');
      }
      await shell.openExternal(url);
    },
    emit,
  });

  autoUpdater.on('download-progress', (progress) => {
    controller.progress(progress.percent);
  });
  autoUpdater.on('error', () => {
    controller.installationFailed();
  });

  const timers: NodeJS.Timeout[] = [];
  if (enabled) {
    timers.push(
      setTimeout(() => void controller.check({ background: true }), STARTUP_CHECK_DELAY_MS),
      setInterval(() => void controller.check({ background: true }), RECHECK_INTERVAL_MS),
    );
  }

  return {
    getStatus: () => controller.getStatus(),
    check: () => controller.check(),
    async setChannel(channel) {
      if (channel !== controller.getStatus().channel) {
        await controller.switchChannel(channel, async () => {
          const next = { ...preferences, updateChannel: channel };
          await writePreferences(directory, next);
          preferences = next;
        });
      }
      return controller.getStatus();
    },
    download: () => controller.download(),
    install: () => controller.install(),
    async copyCommand() {
      const command = controller.getTerminalCommand();
      if (command === null) {
        throw new Error('Check for a macOS update before copying its command.');
      }
      await Promise.resolve(clipboard.writeText(command));
    },
    dispose() {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      autoUpdater.removeAllListeners();
    },
  };
}
