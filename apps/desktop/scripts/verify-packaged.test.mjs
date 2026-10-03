import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { verifyMac } from './verify-packaged.mjs';

function createExecutable(bundle) {
  const path = join(bundle, 'Contents/MacOS/Koma Motion');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'synthetic bundle');
}

async function scenario(fail = '') {
  const release = await mkdtemp(join(tmpdir(), 'koma-packaged-test-'));
  await writeFile(join(release, 'Koma-Motion-0.1.1-universal-mac.zip'), 'ZIP fixture');
  await writeFile(join(release, 'Koma-Motion-0.1.1-universal.dmg'), 'DMG fixture');
  const calls = [];
  let directory;
  const execute = (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === '-x') {
      directory = dirname(args[3]);
      createExecutable(join(args[3], 'Koma Motion.app'));
    }
    if (command.endsWith('hdiutil') && args[0] === 'attach') {
      assert.ok(args.includes('-readonly'));
      assert.ok(args.includes('-nobrowse'));
      const mount = args[args.indexOf('-mountpoint') + 1];
      assert.equal(dirname(mount), directory);
      createExecutable(join(mount, 'Koma Motion.app'));
    }
    if (command.endsWith('ditto') && args[0] !== '-x') {
      assert.match(args[0], /mounted-image/);
      createExecutable(args[1]);
    }
    if (fail === 'detach' && args[0] === 'detach') throw new Error('detach failed');
    if (fail === 'signature' && command.endsWith('codesign') && args.at(-1).includes('dmg'))
      throw new Error('signature failed');
  };
  const tests = [];
  try {
    await verifyMac('0.1.1', release, execute, (executable, version, source) => {
      tests.push({ executable, version, source });
      assert.ok(existsSync(executable));
      assert.ok(!executable.includes('mounted-image'));
      if (source === fail) throw new Error(`${source} test failed`);
    });
    return { calls, tests, directory };
  } catch (error) {
    return { calls, tests, directory, error };
  } finally {
    await rm(release, { recursive: true, force: true });
  }
}

test('macOS verifies and launches the ZIP and the copied DMG bundle separately before detaching', async () => {
  const result = await scenario();
  assert.equal(result.error, undefined);
  assert.deepEqual(
    result.tests.map((item) => item.source),
    ['zip', 'dmg'],
  );
  assert.notEqual(result.tests[0].executable, result.tests[1].executable);
  assert.equal(result.calls.filter(([command]) => command.endsWith('codesign')).length, 2);
  assert.equal(result.calls.filter(([command]) => command.endsWith('lipo')).length, 2);
  assert.equal(result.calls.at(-1)[1], 'detach');
  assert.equal(existsSync(result.directory), false);
});

for (const failure of ['dmg', 'signature', 'zip']) {
  test(`macOS ${failure} failure cannot bypass lifecycle cleanup`, async () => {
    const result = await scenario(failure);
    assert.match(result.error.message, /failed/);
    assert.equal(
      result.calls.some(([, action]) => action === 'detach'),
      failure !== 'zip',
    );
    assert.equal(existsSync(result.directory), false);
  });
}

test('a failed detach preserves the private directory rather than deleting the mounted tree', async () => {
  const result = await scenario('detach');
  try {
    assert.match(result.error.message, /detach failed/);
    assert.equal(existsSync(result.directory), true);
  } finally {
    // This scenario simulates a mount with ordinary files; there is no mounted filesystem.
    await rm(result.directory, { recursive: true, force: true });
  }
});
