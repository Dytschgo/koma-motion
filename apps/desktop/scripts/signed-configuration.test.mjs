import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { packageSigned } from './package-signed.mjs';
import { signedConfiguration } from './signed-configuration.mjs';
import { executeSigningCheck, verifySignedArtifacts } from './verify-signed-artifacts.mjs';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const { getConfig, validateConfiguration } = builderRequire(
  'app-builder-lib/out/util/config/config',
);
const { DebugLogger } = builderRequire('builder-util');
const inspectFile = () => ({ isFile: () => true });
const uuid = '00000000-0000-0000-0000-000000000001';
const windows = {
  AZURE_TENANT_ID: uuid,
  AZURE_CLIENT_ID: uuid,
  AZURE_CLIENT_SECRET: 'synthetic-private-client-secret',
  KOMA_AZURE_SIGNING_ENDPOINT: 'https://eus.codesigning.azure.net/',
  KOMA_AZURE_SIGNING_ACCOUNT: 'fixture-account',
  KOMA_AZURE_SIGNING_PROFILE: 'fixture-profile',
  KOMA_SIGNING_PUBLISHER: 'Fixture Publisher',
};
const mac = {
  CSC_LINK: resolve(desktop, 'synthetic-certificate.p12'),
  CSC_KEY_PASSWORD: 'synthetic-private-password',
  APPLE_API_KEY: resolve(desktop, 'synthetic-api-key.p8'),
  APPLE_API_KEY_ID: 'ABCDEFGHIJ',
  APPLE_API_ISSUER: uuid,
  KOMA_MAC_TEAM_ID: 'ABCDEFGHIJ',
  KOMA_MAC_IDENTITY: 'Fixture Publisher (ABCDEFGHIJ)',
};

test('the real builder resolves valid opt-in configurations without ad-hoc hooks or publishing', async () => {
  for (const [target, environment, platform] of [
    ['win', windows, 'win32'],
    ['mac', mac, 'darwin'],
  ]) {
    const signed = signedConfiguration(target, environment, { platform, inspectFile });
    const config = await getConfig(desktop, null, signed);
    await validateConfiguration(config, new DebugLogger());
    assert.equal(config.appId, 'com.dytschgo.koma-motion');
    assert.equal(config.afterPack, null);
    assert.equal(config.forceCodeSigning, true);
    assert.equal(config.publish, null);
    assert.equal(config.directories.output, 'release/signed');
    assert.equal(config.nsis.perMachine, false);
    if (target === 'mac') {
      assert.equal(config.mac.target, 'zip');
      assert.equal(config.mac.defaultArch, 'universal');
      assert.equal(config.mac.notarize, true);
      assert.equal(config.mac.hardenedRuntime, true);
      assert.equal(config.mac.identity, mac.KOMA_MAC_IDENTITY);
      assert.equal(config.mac.entitlements, 'build/entitlements.signed.mac.plist');
    } else assert.equal(config.win.azureSignOptions.publisherName, windows.KOMA_SIGNING_PUBLISHER);
    for (const secret of [windows.AZURE_CLIENT_SECRET, mac.CSC_KEY_PASSWORD, mac.APPLE_API_KEY])
      assert.ok(!JSON.stringify(config).includes(secret));
  }
});

test('default packaging still resolves unsigned mac settings and the existing ad-hoc hook', async () => {
  const config = await getConfig(desktop, null, undefined);
  assert.equal(config.afterPack, 'scripts/adhoc-sign.cjs');
  assert.equal(config.mac.identity, null);
  assert.equal(config.mac.hardenedRuntime, false);
  assert.deepEqual(config.mac.target, ['dmg', 'zip']);
  assert.equal(config.directories.output, 'release');
  assert.equal(config.win.azureSignOptions, undefined);
  assert.equal(config.forceCodeSigning, undefined);
  assert.ok(config.publish);
});

test('every required input fails closed when missing, blank or partial without exposing values', () => {
  for (const [target, environment, platform] of [
    ['win', windows, 'win32'],
    ['mac', mac, 'darwin'],
  ])
    for (const name of Object.keys(environment)) {
      for (const replacement of [undefined, ' ']) {
        const partial = { ...environment, [name]: replacement };
        assert.throws(
          () => signedConfiguration(target, partial, { platform, inspectFile }),
          (error) => {
            assert.ok(error.message.includes(name));
            assert.ok(!error.message.includes('synthetic-private'));
            return true;
          },
        );
      }
    }
});

test('invalid target, cross-platform packaging, untrusted endpoints and ambiguous credentials fail', () => {
  assert.throws(() => signedConfiguration(undefined, windows), /exactly one/);
  assert.throws(
    () => signedConfiguration('win', windows, { platform: 'darwin' }),
    /native build platform/,
  );
  for (const endpoint of [
    'http://eus.codesigning.azure.net/',
    'https://example.org/',
    'https://eus.codesigning.azure.net/?secret=bad',
    'https://user:password@eus.codesigning.azure.net/',
  ])
    assert.throws(
      () =>
        signedConfiguration(
          'win',
          { ...windows, KOMA_AZURE_SIGNING_ENDPOINT: endpoint },
          { platform: 'win32' },
        ),
      /Invalid signing input/,
    );
  assert.throws(
    () =>
      signedConfiguration(
        'win',
        { ...windows, WIN_CSC_LINK: 'synthetic-secret' },
        { platform: 'win32' },
      ),
    /must be unset: WIN_CSC_LINK/,
  );
  assert.throws(
    () =>
      signedConfiguration(
        'mac',
        { ...mac, APPLE_ID: 'synthetic-secret' },
        { platform: 'darwin', inspectFile },
      ),
    /must be unset: APPLE_ID/,
  );
  for (const identity of [
    '-',
    'Developer ID Application: Fixture Publisher (ABCDEFGHIJ)',
    'Wrong team (XXXXXXXXXX)',
  ])
    assert.throws(
      () =>
        signedConfiguration(
          'mac',
          { ...mac, KOMA_MAC_IDENTITY: identity },
          { platform: 'darwin', inspectFile },
        ),
      /certificate name/,
    );
});

test('local signing files must exist, be files and use explicit absolute paths', () => {
  for (const name of ['CSC_LINK', 'APPLE_API_KEY']) {
    assert.throws(
      () =>
        signedConfiguration('mac', mac, {
          platform: 'darwin',
          inspectFile: () => {
            throw new Error('private-file-name');
          },
        }),
      /existing absolute/,
    );
    assert.throws(
      () =>
        signedConfiguration(
          'mac',
          { ...mac, [name]: 'relative.p12' },
          { platform: 'darwin', inspectFile },
        ),
      /existing absolute/,
    );
    assert.throws(
      () =>
        signedConfiguration('mac', mac, {
          platform: 'darwin',
          inspectFile: () => ({ isFile: () => false }),
        }),
      /existing absolute/,
    );
  }
});

test('wrapper validates before execution and suppresses all child output, including failed secrets', () => {
  const calls = [];
  const messages = [];
  const execute = (command, args, options) => {
    calls.push({ command, args, options });
  };
  assert.throws(
    () => packageSigned('win', { environment: {}, platform: 'win32', execute }),
    /missing/,
  );
  assert.equal(calls.length, 0);
  packageSigned('win', {
    environment: { ...windows, DEBUG: '*', ELECTRON_RUN_AS_NODE: '1' },
    platform: 'win32',
    execute,
    report: (message) => messages.push(message),
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].args[0], /build\.mjs$/);
  assert.match(calls[1].args[0], /package-signed-worker\.mjs$/);
  assert.equal(calls[1].args[1], 'win');
  for (const call of calls) {
    assert.equal(call.options.stdio, 'ignore');
    assert.equal(call.options.env.DEBUG, undefined);
    assert.equal(call.options.env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(call.options.env.AZURE_CLIENT_SECRET, windows.AZURE_CLIENT_SECRET);
  }
  assert.throws(
    () =>
      packageSigned('win', {
        environment: windows,
        platform: 'win32',
        execute: () => {
          throw new Error(windows.AZURE_CLIENT_SECRET);
        },
        report: () => {},
      }),
    (error) => {
      assert.match(error.message, /No artifacts are approved/);
      assert.ok(!error.message.includes(windows.AZURE_CLIENT_SECRET));
      return true;
    },
  );
  assert.ok(!messages.join('\n').includes(windows.AZURE_CLIENT_SECRET));
});

test('mac acceptance rejects ad-hoc, wrong-team and unhardened signatures before notarization checks', () => {
  for (const details of [
    'Signature=adhoc\nTeamIdentifier=not set',
    'Authority=Developer ID Application: Fixture\nTeamIdentifier=WRONGTEAM1\nflags=runtime',
    'Authority=Developer ID Application: Fixture\nTeamIdentifier=ABCDEFGHIJ\nflags=0x0',
  ]) {
    assert.throws(
      () =>
        verifySignedArtifacts('mac', ['fixture.zip'], mac, (command, args) =>
          args.includes('--display') ? details : '',
        ),
      /Developer ID/,
    );
  }
  const calls = [];
  verifySignedArtifacts('mac', ['fixture.zip'], mac, (command, args) => {
    calls.push([command, ...args]);
    return args.includes('--display')
      ? 'Authority=Developer ID Application: Fixture\nTeamIdentifier=ABCDEFGHIJ\nflags=0x10000(runtime)'
      : '';
  });
  assert.ok(calls.some((call) => call.includes('stapler') && call.includes('validate')));
  assert.ok(calls.some((call) => call[0].endsWith('spctl') && call.includes('--assess')));
  assert.throws(
    () => verifySignedArtifacts('mac', ['fixture.zip', 'fixture.dmg'], mac),
    /only the notarized/,
  );
});

test('artifact checks are mandatory for Windows application and installer, and native failures propagate', () => {
  const calls = [];
  verifySignedArtifacts(
    'win',
    ['installer.exe', 'installer.exe.blockmap'],
    windows,
    (command, args) => calls.push([command, ...args]),
  );
  assert.equal(calls.length, 1);
  assert.ok(
    calls[0].some(
      (arg) =>
        arg.endsWith('win-unpacked/Koma Motion.exe') ||
        arg.endsWith('win-unpacked\\Koma Motion.exe'),
    ),
  );
  assert.ok(calls[0].includes('installer.exe'));
  assert.throws(() => verifySignedArtifacts('win', [], windows), /exactly one/);
  assert.throws(
    () =>
      verifySignedArtifacts('win', ['installer.exe'], windows, () => {
        throw new Error('native trust rejection');
      }),
    /native trust rejection/,
  );
  const script = readFileSync(resolve(desktop, 'scripts/verify-authenticode.ps1'), 'utf8');
  assert.match(script, /Get-AuthenticodeSignature -LiteralPath/);
  assert.match(script, /TimeStamperCertificate/);
  assert.match(script, /KOMA_SIGNING_PUBLISHER/);
});

test('signature executor captures stderr and rejects native failure without forwarding child secrets', () => {
  assert.equal(
    executeSigningCheck(
      process.execPath,
      ['-e', 'process.stdout.write("out");process.stderr.write("err")'],
      { stdio: 'pipe' },
    ),
    'outerr',
  );
  assert.throws(
    () =>
      executeSigningCheck(
        process.execPath,
        ['-e', 'process.stderr.write("private-secret");process.exit(1)'],
        { stdio: 'pipe' },
      ),
    (error) => {
      assert.equal(error.message, 'Native signature validation failed.');
      return true;
    },
  );
});

test('entitlements are explicit, narrow and never auto-discovered by unsigned packaging', () => {
  const file = readFileSync(resolve(desktop, 'build/entitlements.signed.mac.plist'), 'utf8');
  assert.deepEqual(
    [...file.matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]),
    ['com.apple.security.cs.allow-jit'],
  );
  assert.ok(
    !readFileSync(resolve(desktop, 'electron-builder.yml'), 'utf8').includes('entitlements.signed'),
  );
});

test('the public CLI rejects missing inputs before build, signing or publishing', () => {
  const result = spawnSync(
    process.execPath,
    [resolve(desktop, 'scripts/package-signed.mjs'), process.platform === 'win32' ? 'win' : 'mac'],
    { env: {}, encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing|native build platform/);
  assert.ok(!result.stdout.includes('Starting'));
  // No external signing services are called by any of these fixture tests.
});
