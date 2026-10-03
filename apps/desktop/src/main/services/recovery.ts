import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_PROJECT_FILE_BYTES, type KomaProject } from '@koma-motion/core';
import { parseProject, serialiseProject } from '@koma-motion/project-format';
import { withProjectFileOperation } from '@koma-motion/project-format/node';
import { z } from 'zod';
import type { RecoveryCapture, RecoveryOffer, RecoveryResult } from '../../shared/recovery';

export const MAX_RECOVERY_BYTES = MAX_PROJECT_FILE_BYTES + 8192;
const recordSchema = z
  .object({
    version: z.literal(1),
    capturedAt: z.string().datetime(),
    sourcePath: z.string().max(4096).nullable(),
    project: z.unknown(),
  })
  .strict();
interface RecoveryRecord {
  capturedAt: string;
  sourcePath: string | null;
  project: KomaProject;
}
const failure = (): RecoveryResult => ({
  status: 'failed',
  message:
    'Recovery snapshot could not be updated. The previous snapshot was kept. Retry or save your project.',
});

/** A validated canonical fingerprint ignores only the timestamp changed by Save. */
function fingerprint(project: KomaProject): string {
  const result = serialiseProject({ ...project, updatedAt: project.createdAt });
  if (!result.ok) throw new Error(result.error.message);
  return createHash('sha256').update(result.value).digest('hex');
}

/** One owned record and one temporary file. No renderer input is a file path. */
export class RecoveryService {
  private readonly directory: string;
  private readonly file: string;
  private readonly temporary: string;
  private loaded: Promise<void> | null = null;
  private pending: RecoveryRecord | 'damaged' | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private epoch: string | null = null;
  private revision = -1;
  private captures = 0;
  private baseline: string | null = null;
  private projectId: string | null = null;
  private sourcePath: string | null = null;

  constructor(userData: string) {
    this.directory = join(userData, 'recovery');
    this.file = join(this.directory, 'snapshot.json');
    this.temporary = join(this.directory, 'snapshot.tmp');
  }

  private queue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work, work);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async ownedDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const entry = await lstat(this.directory);
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new Error('Invalid recovery directory');
  }

  private load(): Promise<void> {
    this.loaded ??= withProjectFileOperation(async () => {
      try {
        await this.ownedDirectory();
        const entry = await lstat(this.file).catch((error: unknown) => {
          if (isMissing(error)) return null;
          throw error;
        });
        if (entry === null) return;
        if (!entry.isFile() || entry.isSymbolicLink() || entry.size > MAX_RECOVERY_BYTES)
          throw new Error('Invalid snapshot');
        const handle = await open(this.file, 'r');
        let contents: Buffer;
        try {
          const chunks: Buffer[] = [];
          let length = 0;
          while (length <= MAX_RECOVERY_BYTES) {
            const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_RECOVERY_BYTES + 1 - length));
            const { bytesRead } = await handle.read(chunk);
            if (bytesRead === 0) break;
            length += bytesRead;
            chunks.push(chunk.subarray(0, bytesRead));
          }
          if (length > MAX_RECOVERY_BYTES) throw new Error('Snapshot too large');
          contents = Buffer.concat(chunks);
        } finally {
          await handle.close();
        }
        const record = recordSchema.parse(JSON.parse(contents.toString('utf8')));
        const parsed = parseProject(JSON.stringify(record.project));
        if (!parsed.ok) throw new Error('Invalid snapshot project');
        this.pending = { ...record, project: parsed.value.project };
      } catch {
        this.pending = 'damaged';
      }
    });
    return this.loaded;
  }

  async offer(): Promise<RecoveryOffer> {
    await this.load();
    if (this.pending === 'damaged')
      return {
        status: 'damaged',
        message:
          'A recovery snapshot could not be read. Your original project was not changed. Discard this snapshot to continue.',
      };
    return this.pending === null
      ? { status: 'none' }
      : {
          status: 'available',
          name: this.pending.project.name,
          capturedAt: this.pending.capturedAt,
        };
  }

  async assertResolved(): Promise<void> {
    await this.load();
    if (this.pending !== null)
      throw new Error('Recover or discard the previous snapshot before starting another project.');
  }

  private async remove(): Promise<void> {
    await this.ownedDirectory();
    await unlink(this.file).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
    });
    await unlink(this.temporary).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
    });
  }

  async discardPending(): Promise<void> {
    await this.load();
    if (this.epoch !== null) throw new Error('No startup recovery decision is pending.');
    await this.queue(() => this.remove());
    this.pending = null;
  }

  /** Called only after a successful native Open or New, never after a cancelled dialog. */
  async activate(project: KomaProject, sourcePath: string | null): Promise<string> {
    await this.assertResolved();
    const epoch = this.start(project, sourcePath, fingerprint(project));
    // A removal failure is reported by the first capture, without leaving the
    // native and renderer projects on different sessions. The old record stays.
    await this.queue(() => this.remove()).catch(() => undefined);
    return epoch;
  }

  private start(project: KomaProject, sourcePath: string | null, baseline: string | null): string {
    this.epoch = randomUUID();
    this.revision = -1;
    this.projectId = project.id;
    this.sourcePath = sourcePath;
    this.baseline = baseline;
    return this.epoch;
  }

  async restore(): Promise<RecoveryRecord & { sessionId: string }> {
    await this.load();
    if (this.pending === null || this.pending === 'damaged' || this.epoch !== null)
      throw new Error('No readable recovery snapshot is available.');
    const record = this.pending;
    this.pending = null;
    return { ...record, sessionId: this.start(record.project, record.sourcePath, null) };
  }

  /** Saving establishes a baseline, but only a matching renderer acknowledgment clears recovery. */
  saved(epoch: string | null, project: KomaProject, sourcePath: string | null): void {
    if (epoch === null || epoch !== this.epoch) return;
    this.baseline = fingerprint(project);
    this.sourcePath = sourcePath;
  }

  get sessionId(): string | null {
    return this.epoch;
  }

  capture(request: RecoveryCapture): Promise<RecoveryResult> {
    if (
      request.sessionId !== this.epoch ||
      request.project.id !== this.projectId ||
      request.revision <= this.revision
    )
      return Promise.resolve({ status: 'stale' });
    this.revision = request.revision;
    if (this.captures >= 2) return Promise.resolve(failure());
    this.captures += 1;
    const current = (): boolean =>
      request.sessionId === this.epoch && request.revision === this.revision;
    return this.queue<RecoveryResult>(() =>
      withProjectFileOperation<RecoveryResult>(async () => {
        if (!current()) return { status: 'stale' };
        try {
          const hash = fingerprint(request.project);
          if (!request.dirty) {
            if (hash !== this.baseline) return failure();
            if (!current()) return { status: 'stale' };
            await this.remove();
            return { status: 'clean' };
          }
          if (this.sourcePath !== null && this.sourcePath.length > 4096) return failure();
          const project = serialiseProject(request.project);
          if (!project.ok) return failure();
          const contents = JSON.stringify({
            version: 1,
            capturedAt: new Date().toISOString(),
            sourcePath: this.sourcePath,
            project: request.project,
          });
          if (Buffer.byteLength(contents) > MAX_RECOVERY_BYTES) return failure();
          await this.ownedDirectory();
          await unlink(this.temporary).catch((error: unknown) => {
            if (!isMissing(error)) throw error;
          });
          const handle = await open(this.temporary, 'wx', 0o600);
          try {
            await handle.writeFile(contents, 'utf8');
            await handle.sync();
          } finally {
            await handle.close();
          }
          if (!current()) {
            await unlink(this.temporary);
            return { status: 'stale' };
          }
          await rename(this.temporary, this.file);
          return { status: 'stored' };
        } catch {
          return failure();
        }
      }),
    ).finally(() => {
      this.captures -= 1;
    });
  }

  /** Only an explicit user discard invalidates unsaved work. */
  async discardActive(): Promise<void> {
    if (this.epoch === null) return;
    this.revision += 1;
    await this.queue(() => this.remove());
    this.epoch = null;
  }

  async flush(): Promise<void> {
    await this.tail;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
