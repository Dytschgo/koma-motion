import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export class SigningInputError extends Error {}

function required(environment, name) {
  const value = environment[name];
  if (typeof value !== 'string' || value.trim() === '')
    throw new SigningInputError(`Required signing input is missing: ${name}`);
  return value;
}

function reject(environment, names) {
  for (const name of names)
    if (environment[name]?.trim())
      throw new SigningInputError(`Conflicting signing input must be unset: ${name}`);
}

function matches(environment, name, pattern) {
  const value = required(environment, name);
  if (!pattern.test(value)) throw new SigningInputError(`Invalid signing input: ${name}`);
  return value;
}

function localFile(environment, name, extension, inspectFile) {
  const value = required(environment, name);
  try {
    if (
      !isAbsolute(value) ||
      !value.toLowerCase().endsWith(extension) ||
      !inspectFile(value).isFile()
    )
      throw new Error('Invalid file');
  } catch {
    throw new SigningInputError(
      `Signing input must name an existing absolute ${extension} file: ${name}`,
    );
  }
  return value;
}

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

/** Explicit opt-in only. Credential values stay in the child environment, never the config. */
export function signedConfiguration(
  target,
  environment,
  { platform = process.platform, inspectFile = statSync } = {},
) {
  const expectedPlatform = target === 'win' ? 'win32' : target === 'mac' ? 'darwin' : null;
  if (expectedPlatform === null)
    throw new SigningInputError('Choose exactly one signing target: win or mac.');
  if (platform !== expectedPlatform)
    throw new SigningInputError(`Signed ${target} packaging requires its native build platform.`);
  const common = {
    extends: './electron-builder.yml',
    directories: { output: 'release/signed' },
    afterPack: null,
    forceCodeSigning: true,
    publish: null,
  };
  if (target === 'win') {
    reject(environment, [
      'CSC_LINK',
      'CSC_KEY_PASSWORD',
      'WIN_CSC_LINK',
      'WIN_CSC_KEY_PASSWORD',
      'AZURE_CLIENT_CERTIFICATE_PATH',
      'AZURE_USERNAME',
      'AZURE_PASSWORD',
    ]);
    matches(environment, 'AZURE_TENANT_ID', UUID);
    matches(environment, 'AZURE_CLIENT_ID', UUID);
    required(environment, 'AZURE_CLIENT_SECRET');
    const endpoint = required(environment, 'KOMA_AZURE_SIGNING_ENDPOINT');
    try {
      const url = new URL(endpoint);
      if (
        url.protocol !== 'https:' ||
        !/^[a-z\d-]+\.codesigning\.azure\.net$/i.test(url.hostname) ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
      )
        throw new Error('Invalid endpoint');
    } catch {
      throw new SigningInputError('Invalid signing input: KOMA_AZURE_SIGNING_ENDPOINT');
    }
    return {
      ...common,
      win: {
        target: 'nsis',
        azureSignOptions: {
          endpoint,
          codeSigningAccountName: matches(
            environment,
            'KOMA_AZURE_SIGNING_ACCOUNT',
            /^[a-z\d-]+$/i,
          ),
          certificateProfileName: matches(
            environment,
            'KOMA_AZURE_SIGNING_PROFILE',
            /^[a-z\d-]+$/i,
          ),
          publisherName: required(environment, 'KOMA_SIGNING_PUBLISHER'),
          fileDigest: 'SHA256',
          timestampDigest: 'SHA256',
          timestampRfc3161: 'http://timestamp.acs.microsoft.com',
        },
      },
    };
  }
  reject(environment, [
    'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_TEAM_ID',
    'APPLE_KEYCHAIN',
    'APPLE_KEYCHAIN_PROFILE',
    'CSC_NAME',
  ]);
  localFile(environment, 'CSC_LINK', '.p12', inspectFile);
  required(environment, 'CSC_KEY_PASSWORD');
  localFile(environment, 'APPLE_API_KEY', '.p8', inspectFile);
  matches(environment, 'APPLE_API_KEY_ID', /^[A-Z\d]{10}$/);
  matches(environment, 'APPLE_API_ISSUER', UUID);
  const team = matches(environment, 'KOMA_MAC_TEAM_ID', /^[A-Z\d]{10}$/);
  const identity = required(environment, 'KOMA_MAC_IDENTITY');
  // Builder 26 selects the Developer ID certificate type itself and rejects a type prefix.
  if (identity === '-' || identity.includes(':') || !identity.endsWith(`(${team})`))
    throw new SigningInputError(
      'KOMA_MAC_IDENTITY must be the certificate name without its type prefix, ending with KOMA_MAC_TEAM_ID in parentheses.',
    );
  return {
    ...common,
    mac: {
      target: 'zip',
      defaultArch: 'universal',
      identity,
      type: 'distribution',
      hardenedRuntime: true,
      entitlements: 'build/entitlements.signed.mac.plist',
      entitlementsInherit: 'build/entitlements.signed.mac.plist',
      notarize: true,
    },
  };
}
