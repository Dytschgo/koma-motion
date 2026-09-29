import { constants } from 'node:fs';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, relative, resolve } from 'node:path';

/**
 * A program that can be started without a shell: an executable file and the
 * arguments that must come before the arguments of the caller.
 */
export interface ResolvedExecutable {
  readonly command: string;
  readonly prefixArguments: readonly string[];
}

export interface ResolutionEnvironment {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory: string;
}

export function getResolutionEnvironment(): ResolutionEnvironment {
  return { platform: process.platform, env: process.env, homeDirectory: homedir() };
}

const EXECUTABLE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Applications started from the macOS Dock or Finder do not inherit the PATH
 * of the login shell, so the usual installation folders are searched as well.
 * Discovery searches PATH and those extra directories. Containing an npm shim
 * script does not stop a hostile PATH entry from selecting a different install.
 */
function getSearchDirectories({ platform, env, homeDirectory }: ResolutionEnvironment): string[] {
  const fromPath = (env['PATH'] ?? env['Path'] ?? '')
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter((entry) => entry !== '' && isAbsolute(entry));
  const additional =
    platform === 'win32'
      ? [join(homeDirectory, '.local', 'bin')]
      : [
          join(homeDirectory, '.local', 'bin'),
          join(homeDirectory, '.npm-global', 'bin'),
          '/opt/homebrew/bin',
          '/usr/local/bin',
        ];
  return [...new Set([...fromPath, ...additional])];
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return await isFile(path);
  } catch {
    return false;
  }
}

/**
 * True when `candidate` is strictly inside `root`. Comparison is
 * case-insensitive on Windows. A shared prefix such as `node_modules_evil`
 * does not count, and `..` is rejected as a segment.
 */
function isInsideDirectory(root: string, candidate: string, platform: NodeJS.Platform): boolean {
  const fromRoot = relative(
    platform === 'win32' ? root.toLowerCase() : root,
    platform === 'win32' ? candidate.toLowerCase() : candidate,
  );
  if (fromRoot === '' || isAbsolute(fromRoot) || fromRoot.startsWith('..')) {
    return false;
  }
  return !fromRoot.split(/[/\\]/).includes('..');
}

/**
 * npm installs command line tools on Windows as `.cmd` files that start
 * Node.js with a script. `.cmd` files can only run through a shell, which
 * Koma Motion never uses. This reads the script path from the `.cmd` file so
 * that Node.js can be started directly.
 */
async function resolveNpmShim(
  shimPath: string,
  directory: string,
  environment: ResolutionEnvironment,
): Promise<ResolvedExecutable | null> {
  let content: string;
  try {
    content = await readFile(shimPath, 'utf8');
  } catch {
    return null;
  }
  const match = /"%(?:~dp0|dp0%)\\(node_modules\\[^"%]+?\.(?:js|cjs|mjs))"/i.exec(content);
  if (match?.[1] === undefined) {
    return null;
  }
  const scriptPath = resolve(directory, match[1]);
  const nodeModulesPath = resolve(directory, 'node_modules');
  // Checked on the path before realpath and again on the canonical path, so a
  // string-prefix escape and a junction that leaves node_modules both fail.
  if (
    match[1].split(/[/\\]/).includes('..') ||
    !isInsideDirectory(nodeModulesPath, scriptPath, environment.platform)
  ) {
    return null;
  }

  let canonicalRoot: string;
  let canonicalScript: string;
  try {
    canonicalRoot = await realpath(nodeModulesPath);
    canonicalScript = await realpath(scriptPath);
  } catch {
    return null;
  }
  if (
    !isInsideDirectory(canonicalRoot, canonicalScript, environment.platform) ||
    !(await isFile(canonicalScript))
  ) {
    return null;
  }

  const bundledNode = join(directory, 'node.exe');
  if (await isFile(bundledNode)) {
    return { command: bundledNode, prefixArguments: [canonicalScript] };
  }
  for (const candidate of getSearchDirectories(environment)) {
    const nodePath = join(candidate, 'node.exe');
    if (await isFile(nodePath)) {
      return { command: nodePath, prefixArguments: [canonicalScript] };
    }
  }
  return null;
}

/**
 * Finds a program by name without starting a shell. Returns `null` when the
 * program is not installed.
 */
export async function resolveExecutable(
  name: string,
  environment: ResolutionEnvironment = getResolutionEnvironment(),
): Promise<ResolvedExecutable | null> {
  if (!EXECUTABLE_NAME_PATTERN.test(name)) {
    return null;
  }
  const directories = getSearchDirectories(environment);

  if (environment.platform !== 'win32') {
    for (const directory of directories) {
      const candidate = join(directory, name);
      if (await isExecutableFile(candidate)) {
        return { command: candidate, prefixArguments: [] };
      }
    }
    return null;
  }

  for (const directory of directories) {
    const executable = join(directory, `${name}.exe`);
    if (await isFile(executable)) {
      return { command: executable, prefixArguments: [] };
    }
  }
  for (const directory of directories) {
    const shim = join(directory, `${name}.cmd`);
    if (await isFile(shim)) {
      const resolved = await resolveNpmShim(shim, directory, environment);
      if (resolved !== null) {
        return resolved;
      }
    }
  }
  return null;
}
