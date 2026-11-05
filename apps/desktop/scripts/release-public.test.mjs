import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../../../.github/workflows/release.yml', import.meta.url),
  'utf8',
);
function job(id) {
  const block = workflow.split(`\n  ${id}:\n`)[1];
  assert.ok(block, `Missing job ${id}`);
  return block.split(/\n  [a-z][a-z-]*:\n/)[0];
}

test('public checks override inherited skips but still require publication or covered recovery', () => {
  for (const id of ['verify-public-download', 'verify-public-download-macos']) {
    const block = job(id);
    const guard = block.split('    if: |\n')[1]?.split('    runs-on:')[0];
    assert.ok(guard, 'Public verification must have an explicit job condition');
    assert.match(guard, /always\(\)/);
    assert.match(guard, /!cancelled\(\)/);
    assert.match(guard, /needs\.classify\.result == 'success'/);
    assert.match(guard, /needs\.publish\.result == 'success'/);
    assert.match(guard, /github\.event_name == 'workflow_dispatch'/);
    assert.match(guard, /needs\.ci-coverage\.result == 'success'/);
    assert.match(guard, /needs\.ci-coverage\.outputs\.covered == 'true'/);
    assert.match(block, /gh release download "\$RELEASE_TAG"/);
    assert.match(block, /verify-packaged\.mjs (windows|macos) ..\/..\/public-download/);
  }
  const promote = job('promote-latest');
  assert.match(promote, /always\(\)/);
  assert.match(promote, /!cancelled\(\)/);
  for (const id of ['classify', 'verify-public-download', 'verify-public-download-macos']) {
    assert.ok(promote.includes(`needs.${id}.result == 'success'`));
  }
});

test('manual recovery pins a stable main tag and requires published assets and exact CI coverage', () => {
  const classify = job('classify');
  assert.match(classify, /test "\$channel" = stable/);
  assert.match(classify, /refs\/tags\/\$RELEASE_TAG\^\{commit\}/);
  assert.match(classify, /merge-base --is-ancestor "\$candidate" origin\/main/);
  assert.match(classify, /git show "\$candidate:apps\/desktop\/package\.json"/);
  assert.match(classify, /test "\$GITHUB_REF" = refs\/heads\/main/);
  assert.match(classify, /\(\.draft == false\) and \(\.prerelease == false\)/);
  assert.match(job('ci-coverage'), /\[ "\$VERIFY_ONLY" = true \] && \[ "\$covered" != true \]/);
  for (const id of ['quality', 'libreoffice', 'package', 'publish']) {
    assert.ok(job(id).includes("github.event_name != 'workflow_dispatch'"));
  }
  assert.match(job('publish'), /--latest=false/);
});
