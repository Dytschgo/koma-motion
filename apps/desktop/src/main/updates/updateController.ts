import type { UpdateChannel, UpdateStatus } from '../../shared/updates';
import { compareReleaseVersions, type ReleaseCandidate } from './releases';

export interface UpdateOperations {
  readonly currentVersion: string;
  /** `false` in builds that are not installed, where updating makes no sense. */
  readonly enabled: boolean;
  /** `true` when this build cannot install updates and opens the download page instead. */
  readonly manual: boolean;
  discover(channel: UpdateChannel): Promise<ReleaseCandidate | null>;
  /** Points the native updater at the release. Not called for manual builds. */
  prepare(release: ReleaseCandidate): Promise<void>;
  download(): Promise<unknown>;
  install(): void | Promise<void>;
  /** Opens the page of a release in the browser. */
  open(url: string): Promise<unknown>;
  emit(status: UpdateStatus): void;
}

type StatusChange = Omit<UpdateStatus, 'channel' | 'currentVersion'>;

const BUSY_STATES: readonly UpdateStatus['state'][] = ['checking', 'downloading', 'downloaded'];

/**
 * The state of updating. There is one operation at a time, and a release
 * that was selected on one channel is never installed on another.
 *
 * Nothing is downloaded or installed without a request of the user.
 */
export class UpdateController {
  readonly #ops: UpdateOperations;
  #channel: UpdateChannel;
  #status: UpdateStatus;
  #candidate: ReleaseCandidate | null = null;
  #pending: Promise<void> | null = null;
  #pendingIsBackground = false;
  #switching = false;

  constructor(channel: UpdateChannel, ops: UpdateOperations) {
    this.#ops = ops;
    this.#channel = channel;
    this.#status = { state: 'idle', channel, currentVersion: ops.currentVersion };
  }

  getStatus(): UpdateStatus {
    return { ...this.#status };
  }

  #send(change: StatusChange): void {
    this.#status = {
      ...change,
      channel: this.#channel,
      currentVersion: this.#ops.currentVersion,
    };
    this.#ops.emit(this.getStatus());
  }

  /** Changes the channel. `persist` stores the choice; when it fails, nothing changes. */
  async switchChannel(channel: UpdateChannel, persist: () => Promise<void>): Promise<void> {
    if (this.#switching || this.#pending !== null || BUSY_STATES.includes(this.#status.state)) {
      throw new Error('Finish the current update before you change the channel.');
    }
    this.#switching = true;
    try {
      await persist();
      this.#channel = channel;
      this.#candidate = null;
      this.#send({ state: 'idle' });
    } finally {
      this.#switching = false;
    }
    void this.check();
  }

  /**
   * Checks for an update. A check the user asked for reports progress and
   * failures. A background check stays silent: it never replaces an update
   * that was already found with "checking", and when it fails the previous
   * state stays.
   */
  check(options: { readonly background?: boolean } = {}): Promise<void> {
    const background = options.background === true;
    if (this.#pending !== null) {
      if (!background && this.#pendingIsBackground) {
        this.#pendingIsBackground = false;
        this.#send({ state: 'checking' });
      }
      return this.#pending;
    }
    if (
      this.#switching ||
      this.#status.state === 'downloading' ||
      this.#status.state === 'downloaded'
    ) {
      return Promise.resolve();
    }
    if (!this.#ops.enabled) {
      if (!background) {
        this.#send({
          state: 'idle',
          message: 'Updates are available in installed versions of Koma Motion.',
        });
      }
      return Promise.resolve();
    }

    const previous = { status: this.getStatus(), candidate: this.#candidate };
    let preparationStarted = false;
    this.#candidate = null;
    this.#pendingIsBackground = background;
    if (!background) {
      this.#send({ state: 'checking' });
    }
    this.#pending = this.#performCheck(() => {
      preparationStarted = true;
    })
      .catch(() => {
        // A native updater may already point at the new release once preparation started.
        if (this.#pendingIsBackground && !preparationStarted) {
          this.#candidate = previous.candidate;
          this.#status = previous.status;
          return;
        }
        this.#candidate = null;
        this.#send({
          state: 'error',
          message:
            'The check for updates failed. Check your connection and try again. Your projects are unchanged.',
        });
      })
      .finally(() => {
        this.#pending = null;
        this.#pendingIsBackground = false;
      });
    return this.#pending;
  }

  async #performCheck(onPreparationStart: () => void): Promise<void> {
    const candidate = await this.#ops.discover(this.#channel);
    if (candidate === null) {
      this.#send({
        state: 'not-available',
        message: `No ${this.#channel} version has been published yet.`,
      });
      return;
    }

    const comparison = compareReleaseVersions(candidate.version, this.#ops.currentVersion);
    const stableOnNightly = this.#channel === 'nightly' && candidate.sourceChannel === 'stable';
    const found = {
      version: candidate.version,
      releaseUrl: candidate.url,
      sourceChannel: candidate.sourceChannel,
    };

    if (comparison <= 0) {
      this.#candidate = candidate;
      let message = `You have the latest ${this.#channel} version.`;
      if (comparison < 0) {
        message = `Your version is newer than ${candidate.sourceChannel} ${candidate.version}. Koma Motion never installs an older version by itself.`;
      } else if (stableOnNightly) {
        message = `You have stable ${candidate.version}, the newest version there is. Nightly stays selected.`;
      }
      this.#send({ state: 'not-available', ...found, manualDownload: comparison < 0, message });
      return;
    }

    if (!this.#ops.manual) {
      onPreparationStart();
      await this.#ops.prepare(candidate);
    }
    this.#candidate = candidate;
    this.#send({
      state: 'available',
      ...found,
      manualDownload: this.#ops.manual,
      ...(stableOnNightly
        ? {
            message: `Stable ${candidate.version} is newer than the latest nightly. Nightly stays selected.`,
          }
        : {}),
    });
  }

  /** Reports the progress of a download, 0 to 100. */
  progress(percent: number): void {
    if (this.#status.state === 'downloading' && Number.isFinite(percent)) {
      this.#send({ ...this.#status, percent: Math.max(0, Math.min(percent, 100)) });
    }
  }

  /** Downloads the update, or opens its page when this build cannot install it. */
  async download(): Promise<void> {
    if (this.#switching) {
      throw new Error('Check for updates first.');
    }
    if (this.#pending !== null) {
      await this.#pending;
    }
    if (this.#candidate === null) {
      throw new Error('There is no update to download.');
    }
    if (this.#status.manualDownload === true) {
      await this.#ops.open(this.#candidate.url);
      return;
    }
    if (this.#status.state !== 'available') {
      throw new Error('There is no update to download.');
    }
    const { message: _message, ...status } = this.#status;
    this.#send({ ...status, state: 'downloading', percent: 0 });
    try {
      await this.#ops.download();
      this.#send({ ...status, state: 'downloaded', percent: 100 });
    } catch {
      this.#candidate = null;
      this.#send({
        state: 'error',
        message:
          'The download failed. Check for updates to try again. Your projects are unchanged.',
      });
    }
  }

  /** Restarts the application and installs the downloaded update. */
  async install(): Promise<void> {
    if (
      this.#status.state !== 'downloaded' ||
      this.#ops.manual ||
      this.#status.installing === true
    ) {
      throw new Error('Download an update before you install it.');
    }
    this.#send({ ...this.#status, installing: true, message: 'Preparing to restart' });
    try {
      await this.#ops.install();
    } catch {
      this.installationFailed();
      throw new Error('The update could not be installed. Your current version still works.');
    }
  }

  installationFailed(): void {
    if (this.#status.installing !== true) {
      return;
    }
    this.#send({
      ...this.#status,
      installing: false,
      message: 'The installation did not start. Your current version is unchanged.',
    });
  }
}
