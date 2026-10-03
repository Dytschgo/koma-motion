// Internal worker: the public wrapper suppresses all output from builder and native signing tools.
import { createRequire } from 'node:module';
import { signedConfiguration } from './signed-configuration.mjs';
import { verifySignedArtifacts } from './verify-signed-artifacts.mjs';

const require = createRequire(import.meta.url);
const { build, Platform, Arch } = require('electron-builder');
const target = process.argv[2];
try {
  const config = signedConfiguration(target, process.env);
  const targets =
    target === 'win'
      ? Platform.WINDOWS.createTarget('nsis', Arch.x64)
      : Platform.MAC.createTarget('zip', Arch.universal);
  const artifacts = await build({ config, targets, publish: 'never' });
  verifySignedArtifacts(target, artifacts, process.env);
} catch {
  process.exitCode = 1;
}
