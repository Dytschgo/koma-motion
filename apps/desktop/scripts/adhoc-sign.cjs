/**
 * Signs the macOS application ad hoc after it is assembled.
 *
 * There is no Developer ID certificate yet. An ad hoc signature is not a
 * proof of origin, but without any signature the application does not start
 * on Apple silicon. It is applied before archives and update checksums are
 * created, so they describe the signed application.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }
  // A universal build calls this for both temporary single-architecture
  // bundles. Their signatures would differ and prevent the merge.
  if (/^mac-universal-(?:x64|arm64)-temp$/.test(path.basename(context.appOutDir))) {
    return;
  }
  const bundle = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync(
    '/usr/bin/codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', bundle],
    { stdio: 'inherit' },
  );
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], {
    stdio: 'inherit',
  });
};
