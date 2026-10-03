import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export function executeSigningCheck(command, args, options) {
  const result = spawnSync(command, args, { ...options, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('Native signature validation failed.');
  return result.stdout + result.stderr;
}

/** Calls OS trust checks; mocks of this function cannot establish signed acceptance. */
export function verifySignedArtifacts(
  target,
  artifacts,
  environment,
  execute = executeSigningCheck,
) {
  if (target === 'win') {
    const installers = artifacts.filter((file) => /\.exe$/i.test(file));
    if (installers.length !== 1) throw new Error('Expected exactly one signed NSIS installer.');
    execute(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        resolve('scripts/verify-authenticode.ps1'),
        resolve('release/signed/win-unpacked/Koma Motion.exe'),
        installers[0],
      ],
      { stdio: 'pipe', env: environment },
    );
    return;
  }
  if (
    target !== 'mac' ||
    artifacts.filter((file) => /\.zip$/i.test(file)).length !== 1 ||
    artifacts.some((file) => /\.dmg$/i.test(file))
  )
    throw new Error('Expected only the notarized universal ZIP distribution.');
  const bundle = resolve('release/signed/mac-universal/Koma Motion.app');
  const options = { stdio: ['ignore', 'pipe', 'pipe'], env: environment };
  execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], options);
  // codesign -d writes to stderr; the executor captures both streams without logging them.
  const details = execute('/usr/bin/codesign', ['--display', '--verbose=4', bundle], options);
  if (
    !/^Authority=Developer ID Application: /m.test(details) ||
    !details.split(/\r?\n/).includes(`TeamIdentifier=${environment['KOMA_MAC_TEAM_ID']}`) ||
    !/flags=.*runtime/m.test(details)
  )
    throw new Error(
      'Expected a Developer ID Application signature, configured team and hardened runtime.',
    );
  execute('/usr/bin/xcrun', ['stapler', 'validate', bundle], options);
  execute('/usr/sbin/spctl', ['--assess', '--type', 'execute', bundle], options);
}
