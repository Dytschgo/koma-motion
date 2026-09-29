import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import type { ResolvedExecutable } from './resolveExecutable';

export const MAX_ARGUMENT_LENGTH = 24_000;
const FORCE_KILL_DELAY_MS = 2000;

export interface ProcessSpecification {
  readonly executable: ResolvedExecutable;
  readonly arguments: readonly string[];
  /** Text written to standard input. The prompt travels here, never as an argument. */
  readonly input: string;
  readonly workingDirectory: string;
  /** Stops the process when aborted. */
  readonly signal: AbortSignal;
  /** Combined limit for standard output and standard error, in bytes. */
  readonly maxOutputBytes: number;
}

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly standardOutput: string;
  readonly standardError: string;
  readonly outputLimitExceeded: boolean;
  readonly aborted: boolean;
  /** Set when the process could not be started. */
  readonly startError: string | null;
}

/**
 * Checks arguments before they reach a process. Arguments are passed as an
 * array and never interpreted by a shell, so this guards against values that
 * are malformed rather than against shell injection.
 */
export function assertSafeArguments(values: readonly string[]): void {
  for (const value of values) {
    if (typeof value !== 'string') {
      throw new TypeError('Process arguments must be strings');
    }
    if (value.includes('\u0000')) {
      throw new RangeError('Process arguments must not contain NUL characters');
    }
    if (value.length > MAX_ARGUMENT_LENGTH) {
      throw new RangeError('A process argument is too long');
    }
  }
}

/** Stops a process together with the processes it started. */
function terminate(child: ChildProcess): void {
  const { pid } = child;
  if (pid === undefined || child.exitCode !== null) {
    return;
  }
  if (process.platform === 'win32') {
    const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
    const killer = spawn(
      join(systemRoot, 'System32', 'taskkill.exe'),
      ['/PID', String(pid), '/T', '/F'],
      { shell: false, windowsHide: true, stdio: 'ignore' },
    );
    killer.on('error', () => {
      child.kill();
    });
    return;
  }
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      // The process was started as the leader of its own group.
      process.kill(-pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  signalGroup('SIGTERM');
  setTimeout(() => {
    if (child.exitCode === null) {
      signalGroup('SIGKILL');
    }
  }, FORCE_KILL_DELAY_MS).unref();
}

/**
 * Starts a program without a shell and collects its output.
 *
 * The promise always resolves. Failure to start, a non-zero exit code, an
 * abort and an exceeded output limit are all described in the result.
 */
export function runProcess(specification: ProcessSpecification): Promise<ProcessResult> {
  const { executable, signal, maxOutputBytes } = specification;
  const allArguments = [...executable.prefixArguments, ...specification.arguments];
  assertSafeArguments(allArguments);

  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({
        exitCode: null,
        standardOutput: '',
        standardError: '',
        outputLimitExceeded: false,
        aborted: true,
        startError: null,
      });
      return;
    }

    const child = spawn(executable.command, allArguments, {
      cwd: specification.workingDirectory,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let receivedBytes = 0;
    let outputLimitExceeded = false;
    let aborted = false;
    let startError: string | null = null;
    let settled = false;

    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (receivedBytes > maxOutputBytes) {
        if (!outputLimitExceeded) {
          outputLimitExceeded = true;
          terminate(child);
        }
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', collect(output));
    child.stderr.on('data', collect(errors));

    const onAbort = (): void => {
      aborted = true;
      terminate(child);
    };
    signal.addEventListener('abort', onAbort, { once: true });

    const finish = (exitCode: number | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve({
        exitCode,
        standardOutput: Buffer.concat(output).toString('utf8'),
        standardError: Buffer.concat(errors).toString('utf8'),
        outputLimitExceeded,
        aborted,
        startError,
      });
    };

    child.on('error', (error: NodeJS.ErrnoException) => {
      startError = error.code ?? 'UNKNOWN';
      finish(null);
    });
    child.on('close', (exitCode) => {
      finish(exitCode);
    });

    // A program that exits early closes its input: that is not an error here.
    child.stdin.on('error', () => undefined);
    child.stdin.end(specification.input, 'utf8');
  });
}
