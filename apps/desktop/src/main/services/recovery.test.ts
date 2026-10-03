import * as filesystem from 'node:fs/promises';
import { mkdtemp, mkdir, readFile, rm, writeFile, open, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildKoma, buildPresentation, buildProject } from '@koma-motion/core/testing';
import { withProjectFileOperation } from '@koma-motion/project-format/node';
import { MAX_RECOVERY_BYTES, RecoveryService } from './recovery';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof filesystem>();
  return { ...actual, unlink: vi.fn(actual.unlink) };
});

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'koma-recovery-'));
  directories.push(directory);
  return {
    directory,
    service: new RecoveryService(directory),
    file: join(directory, 'recovery', 'snapshot.json'),
  };
}
const project = buildProject({
  name: 'Original',
  presentation: buildPresentation({ komas: [buildKoma({ holdDurationMs: 2500 })] }),
});
const edited = { ...project, name: 'Committed edit' };

describe('private crash recovery snapshots', () => {
  it('retains committed project bytes and holds across restart without writing the original', async () => {
    const { directory, service, file } = await setup();
    const source = join(directory, 'original.koma');
    await writeFile(source, JSON.stringify(project));
    const sessionId = await service.activate(project, source);
    expect(await service.capture({ sessionId, revision: 1, project: edited, dirty: true })).toEqual(
      { status: 'stored' },
    );
    const restarted = new RecoveryService(directory);
    expect(await restarted.offer()).toMatchObject({ status: 'available', name: edited.name });
    await expect(restarted.assertResolved()).rejects.toThrow('Recover or discard');
    const restored = await restarted.restore();
    expect(restored.project).toEqual(edited);
    expect(restored.project.presentation.komas[0]?.holdDurationMs).toBe(2500);
    expect(restored.sourcePath).toBe(source);
    expect(restored.sessionId).not.toBe(sessionId);
    expect(await readFile(source, 'utf8')).toBe(JSON.stringify(project));
    expect(await lstat(file)).toBeDefined();
  });

  it('does not clear a snapshot for an unverified clean claim or a failed save', async () => {
    const { service, directory } = await setup();
    const sessionId = await service.activate(project, null);
    await service.capture({ sessionId, revision: 1, project: edited, dirty: true });
    expect(
      (await service.capture({ sessionId, revision: 2, project: edited, dirty: false })).status,
    ).toBe('failed');
    expect(await new RecoveryService(directory).offer()).toMatchObject({
      status: 'available',
      name: edited.name,
    });
    service.saved(sessionId, edited, null);
    expect(
      await service.capture({ sessionId, revision: 3, project: edited, dirty: false }),
    ).toEqual({ status: 'clean' });
    expect(await new RecoveryService(directory).offer()).toEqual({ status: 'none' });
  });

  it('keeps newer edits after a previous revision saved and accepts only the current epoch', async () => {
    const { service, directory } = await setup();
    const sessionId = await service.activate(project, null);
    service.saved(sessionId, project, null);
    await service.capture({ sessionId, revision: 4, project: edited, dirty: true });
    expect(await service.capture({ sessionId, revision: 3, project, dirty: false })).toEqual({
      status: 'stale',
    });
    expect(await new RecoveryService(directory).offer()).toMatchObject({ name: edited.name });
    const replacement = await service.activate(project, null);
    expect(replacement).not.toBe(sessionId);
    expect(await service.capture({ sessionId, revision: 5, project: edited, dirty: true })).toEqual(
      { status: 'stale' },
    );
    expect(await new RecoveryService(directory).offer()).toEqual({ status: 'none' });
  });

  it('rejects a queued capture after switching sessions, including the same project id', async () => {
    const { service, directory } = await setup();
    const sessionId = await service.activate(project, null);
    let release = () => {};
    const blocked = withProjectFileOperation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    await Promise.resolve();
    const capture = service.capture({ sessionId, revision: 1, project: edited, dirty: true });
    const replacement = service.activate(project, null);
    await Promise.resolve();
    await Promise.resolve();
    release();
    await blocked;
    expect(await capture).toEqual({ status: 'stale' });
    await replacement;
    expect(await new RecoveryService(directory).offer()).toEqual({ status: 'none' });
  });

  it('retains the previous record on a failed atomic write and can retry', async () => {
    const { service, file, directory } = await setup();
    const sessionId = await service.activate(project, null);
    await service.capture({ sessionId, revision: 1, project: edited, dirty: true });
    const previous = await readFile(file, 'utf8');
    const temporary = join(directory, 'recovery', 'snapshot.tmp');
    await mkdir(temporary);
    expect(
      (
        await service.capture({
          sessionId,
          revision: 2,
          project: { ...edited, name: 'Later' },
          dirty: true,
        })
      ).status,
    ).toBe('failed');
    expect(await readFile(file, 'utf8')).toBe(previous);
    await rm(temporary, { recursive: true });
    expect(
      (await service.capture({ sessionId, revision: 3, project: edited, dirty: true })).status,
    ).toBe('stored');
  });

  it('explicit discard removes recovery, while merely inspecting an offer keeps it', async () => {
    const { service, directory } = await setup();
    const sessionId = await service.activate(project, null);
    await service.capture({ sessionId, revision: 1, project: edited, dirty: true });
    const restarted = new RecoveryService(directory);
    await restarted.offer();
    await restarted.flush();
    expect((await new RecoveryService(directory).offer()).status).toBe('available');
    await restarted.discardPending();
    expect(await new RecoveryService(directory).offer()).toEqual({ status: 'none' });
    await service.discardActive();
    expect(await service.capture({ sessionId, revision: 2, project: edited, dirty: true })).toEqual(
      { status: 'stale' },
    );
  });

  for (const malformed of [
    'not json',
    JSON.stringify({ version: 1, project: {} }),
    JSON.stringify({
      version: 99,
      capturedAt: new Date().toISOString(),
      sourcePath: null,
      project,
    }),
  ]) {
    it('retains damaged data until explicit discard', async () => {
      const { directory, file } = await setup();
      await mkdir(join(directory, 'recovery'));
      await writeFile(file, malformed);
      const service = new RecoveryService(directory);
      expect((await service.offer()).status).toBe('damaged');
      await expect(service.restore()).rejects.toThrow();
      expect(await readFile(file, 'utf8')).toBe(malformed);
      await service.discardPending();
      expect(await new RecoveryService(directory).offer()).toEqual({ status: 'none' });
    });
  }

  it('rejects an oversized record before reading it and keeps it untouched', async () => {
    const { directory, file } = await setup();
    await mkdir(join(directory, 'recovery'));
    const handle = await open(file, 'w');
    await handle.truncate(MAX_RECOVERY_BYTES + 1);
    await handle.close();
    expect((await new RecoveryService(directory).offer()).status).toBe('damaged');
    expect((await lstat(file)).size).toBe(MAX_RECOVERY_BYTES + 1);
  });

  it('bounds in-flight captures and retains the previous snapshot under overload', async () => {
    const { service, directory } = await setup();
    const sessionId = await service.activate(project, null);
    await service.capture({ sessionId, revision: 1, project: edited, dirty: true });
    const captures = [2, 3, 4].map((revision) =>
      service.capture({ sessionId, revision, project: edited, dirty: true }),
    );
    expect((await captures[2])?.status).toBe('failed');
    await Promise.all(captures);
    expect((await new RecoveryService(directory).offer()).status).toBe('available');
  });
});

describe('discard ordering audit', () => {
  async function blockWrites(service: RecoveryService, sessionId: string) {
    let release = () => {};
    let entered = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = withProjectFileOperation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
          entered();
        }),
    );
    await started;
    const capture = service.capture({ sessionId, revision: 2, project: edited, dirty: true });
    return {
      release: async () => {
        release();
        await blocked;
        await capture;
      },
    };
  }

  it('cannot recreate a snapshot with a newer same-epoch capture queued during discard', async () => {
    const { service, directory } = await setup();
    const sessionId = await service.activate(project, null);
    await service.capture({ sessionId, revision: 1, project: edited, dirty: true });
    const held = await blockWrites(service, sessionId);
    const discard = service.discardActive();
    const duringDiscard = service.capture({ sessionId, revision: 4, project: edited, dirty: true });
    await held.release();
    await discard;
    expect(await duringDiscard).toEqual({ status: 'stale' });
    await service.flush();
    expect(service.sessionId).toBeNull();
    expect(await new RecoveryService(directory).offer()).toEqual({ status: 'none' });
  });

  it('preserves the old snapshot and active epoch after removal failure, then permits retry', async () => {
    const { service, directory, file } = await setup();
    const sessionId = await service.activate(project, null);
    await service.capture({ sessionId, revision: 1, project: edited, dirty: true });
    const previous = await readFile(file, 'utf8');
    const held = await blockWrites(service, sessionId);
    const unlink = vi.mocked(filesystem.unlink);
    unlink.mockRejectedValueOnce(Object.assign(new Error('Access denied'), { code: 'EACCES' }));
    const discard = service.discardActive();
    const failed = expect(discard).rejects.toThrow('Access denied');
    await held.release();
    await failed;
    expect(service.sessionId).toBe(sessionId);
    expect(await readFile(file, 'utf8')).toBe(previous);
    expect(
      (await service.capture({ sessionId, revision: 4, project: edited, dirty: true })).status,
    ).toBe('stored');
    await service.discardActive();
    expect(service.sessionId).toBeNull();
    expect(await new RecoveryService(directory).offer()).toEqual({ status: 'none' });
  });

  it('does not invalidate a replacement epoch while an old discard is pending', async () => {
    const { service, directory } = await setup();
    const sessionId = await service.activate(project, null);
    await service.capture({ sessionId, revision: 1, project: edited, dirty: true });
    const held = await blockWrites(service, sessionId);
    const discard = service.discardActive();
    const replacement = service.activate(project, null);
    await held.release();
    await discard;
    const nextId = await replacement;
    expect(service.sessionId).toBe(nextId);
    expect(
      (await service.capture({ sessionId: nextId, revision: 1, project: edited, dirty: true }))
        .status,
    ).toBe('stored');
    expect(await new RecoveryService(directory).offer()).toMatchObject({
      status: 'available',
      name: edited.name,
    });
  });
});
