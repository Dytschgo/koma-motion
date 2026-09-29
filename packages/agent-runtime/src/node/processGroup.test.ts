/**
 * Termination of a process group on POSIX. Windows ends the whole process
 * tree with one command and is covered by the tests in `node.test.ts`.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runProcess } from './runProcess';

/** The descendant ends by itself, so a failing test leaves nothing behind. */
const DESCENDANT_LIFETIME_MS = 20_000;

let directory: string;
let descendantPid: number | null = null;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'koma-process-group-'));
  descendantPid = null;
});

afterEach(async () => {
  if (descendantPid !== null && isRunning(descendantPid)) {
    process.kill(descendantPid, 'SIGKILL');
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 3 });
});

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function waitFor<T>(read: () => Promise<T | null>, what: string): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    const value = await read();
    if (value !== null) {
      return value;
    }
    await pause(30);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Ignores SIGTERM and reports when it is ready to be signalled. */
const DESCENDANT = `
process.on('SIGTERM', () => {});
require('node:fs').writeFileSync(process.argv[1], String(process.pid));
setTimeout(() => process.exit(0), ${String(DESCENDANT_LIFETIME_MS)});
`;

/**
 * Starts the descendant in its own process group and ends on SIGTERM. The
 * descendant does not share the pipes of the leader, so the leader is
 * reported as finished while the descendant still runs.
 */
const LEADER = `
const { spawn } = require('node:child_process');
spawn(process.execPath, ['-e', process.argv[3], process.argv[2]], { stdio: 'ignore' });
setInterval(() => {}, 1000);
`;

describe.runIf(process.platform !== 'win32')('process group termination', () => {
  it('ends a descendant that ignores SIGTERM after the leader has exited', async () => {
    const pidFile = join(directory, 'descendant.pid');
    const leaderScript = join(directory, 'leader.cjs');
    await writeFile(leaderScript, LEADER, 'utf8');

    const controller = new AbortController();
    const pending = runProcess({
      executable: { command: process.execPath, prefixArguments: [] },
      arguments: [leaderScript, pidFile, DESCENDANT],
      input: '',
      workingDirectory: directory,
      signal: controller.signal,
      maxOutputBytes: 1024 * 1024,
    });

    descendantPid = await waitFor(async () => {
      const text = await readFile(pidFile, 'utf8').catch(() => '');
      const pid = Number.parseInt(text, 10);
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    }, 'the descendant');
    // The handler for SIGTERM is installed before the pid is written.
    await pause(100);

    const aborted = Date.now();
    controller.abort();
    const result = await pending;
    expect(result.aborted).toBe(true);

    // The leader is gone, the descendant ignored SIGTERM and still runs.
    expect(isRunning(descendantPid)).toBe(true);

    const pid = descendantPid;
    await waitFor(() => Promise.resolve(isRunning(pid) ? null : true), 'the descendant to end');
    const elapsed = Date.now() - aborted;

    // It ended through the delayed SIGKILL, long before it would have ended by itself.
    expect(elapsed).toBeGreaterThan(1_000);
    expect(elapsed).toBeLessThan(DESCENDANT_LIFETIME_MS / 2);
  }, 20_000);
});
