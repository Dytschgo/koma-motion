import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signedConfiguration, SigningInputError } from './signed-configuration.mjs';

const scripts = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(scripts, '..');

/** Validate before any build or network activity. Never forward signing-worker output. */
export function packageSigned(
  target,
  {
    environment = process.env,
    platform = process.platform,
    execute = execFileSync,
    inspectFile,
    report = console.log,
  } = {},
) {
  signedConfiguration(target, environment, { platform, ...(inspectFile ? { inspectFile } : {}) });
  const childEnvironment = { ...environment };
  delete childEnvironment['ELECTRON_RUN_AS_NODE'];
  delete childEnvironment['DEBUG'];
  delete childEnvironment['DEBUG_COLORS'];
  for (const [stage, arguments_] of [
    ['application build', [resolve(scripts, 'build.mjs')]],
    ['signing and artifact validation', [resolve(scripts, 'package-signed-worker.mjs'), target]],
  ]) {
    report(`Starting ${stage}. Child output is suppressed to protect signing inputs.`);
    try {
      execute(process.execPath, arguments_, {
        cwd: desktop,
        env: childEnvironment,
        stdio: 'ignore',
      });
    } catch {
      throw new SigningInputError(
        `Optional signed packaging failed during ${stage}. No artifacts are approved for publishing; child output was suppressed.`,
      );
    }
  }
  report(
    'Optional signed packaging and signature checks completed in release/signed. Packaged application acceptance remains required before distribution.',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3)
      throw new SigningInputError('Usage: node apps/desktop/scripts/package-signed.mjs win|mac');
    packageSigned(process.argv[2]);
  } catch (error) {
    console.error(
      error instanceof SigningInputError
        ? error.message
        : 'Optional signed packaging failed. No artifacts are approved for publishing.',
    );
    process.exitCode = 1;
  }
}
