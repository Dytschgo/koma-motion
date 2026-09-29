import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import type { ResolvedExecutable } from './resolveExecutable';

export const MAX_ARGUMENT_LENGTH = 24_000;
const FORCE_KILL_DELAY_MS = 2000;
/** CreateProcess limit for the quoted command line, in UTF-16 code units. */
const WINDOWS_MAX_COMMAND_LINE_LENGTH = 32_767;

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

function systemErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error;
    if (typeof code === 'string' && code !== '') {
      return code;
    }
  }
  return 'UNKNOWN';
}

/**
 * Quotes one argument the way libuv builds a Windows command line
 * (`quote_cmd_arg`). Empty arguments, spaces, tabs and embedded quotes are
 * included so the measured length matches what CreateProcess receives.
 */
function quoteWindowsArgument(source: string): string {
  if (source.length === 0) {
    return '""';
  }
  if (!/[\t "]/.test(source)) {
    return source;
  }
  if (!/["\\]/.test(source)) {
    return `"${source}"`;
  }

  const characters: string[] = [];
  let quoteHit = true;
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const character = source.charAt(index);
    characters.push(character);
    if (quoteHit && character === '\\') {
      characters.push('\\');
    } else if (character === '"') {
      quoteHit = true;
      characters.push('\\');
    } else {
      quoteHit = false;
    }
  }
  characters.reverse();
  return `"${characters.join('')}"`;
}

/** Length of the command line Node passes to CreateProcess on Windows. */
function windowsCommandLineLength(executable: string, args: readonly string[]): number {
  const parts = [executable, ...args];
  let length = parts.length > 0 ? parts.length - 1 : 0;
  for (const part of parts) {
    length += quoteWindowsArgument(part).length;
  }
  return length;
}

function didNotStart(startError: string | null, aborted = false): ProcessResult {
  return {
    exitCode: null,
    standardOutput: '',
    standardError: '',
    outputLimitExceeded: false,
    aborted,
    startError,
  };
}

/** Stops a process together with the processes it started. */
function terminate(child: ChildProcess): void {
  const { pid } = child;
  if (pid === undefined) {
    return;
  }
  if (process.platform === 'win32') {
    if (child.exitCode !== null) {
      return;
    }
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

  // POSIX process group. This branch is not executed on Windows (taskkill
  // above is). It was not run on macOS. SIGKILL is sent to the group after
  // the delay even when the leader has already exited, because a descendant
  // can still be in the group. ESRCH means the group is gone.
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if (systemErrorCode(error) === 'ESRCH') {
        return;
      }
    }
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      if (systemErrorCode(error) === 'ESRCH') {
        return;
      }
    }
  }, FORCE_KILL_DELAY_MS).unref();
}

/**
 * Starts a program without a shell and collects its output.
 *
 * The promise always resolves. Failure to start, including a synchronous
 * spawn error, a non-zero exit code, an abort and an exceeded output limit
 * are all described in the result.
 */
export function runProcess(specification: ProcessSpecification): Promise<ProcessResult> {
  const { executable, signal, maxOutputBytes } = specification;
  const allArguments = [...executable.prefixArguments, ...specification.arguments];
  assertSafeArguments(allArguments);

  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(didNotStart(null, true));
      return;
    }

    if (
      process.platform === 'win32' &&
      windowsCommandLineLength(executable.command, allArguments) > WINDOWS_MAX_COMMAND_LINE_LENGTH
    ) {
      resolve(didNotStart('ENAMETOOLONG'));
      return;
    }

    let child: ChildProcess;
    try {
      child = spawn(executable.command, allArguments, {
        cwd: specification.workingDirectory,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve(didNotStart(systemErrorCode(error)));
      return;
    }

    const { stdin, stdout, stderr } = child;
    if (stdin === null || stdout === null || stderr === null) {
      terminate(child);
      resolve(didNotStart('UNKNOWN'));
      return;
    }

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
    stdout.on('data', collect(output));
    stderr.on('data', collect(errors));

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
    stdin.on('error', () => undefined);
    stdin.end(specification.input, 'utf8');
  });
}
