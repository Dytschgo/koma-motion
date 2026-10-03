import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  jobsCoverWindowsQuality,
  selectCoveringRun,
  windowsQualityJobNames,
} from './ci-quality.mjs';

const SHA = 'abc123';
const scripts = dirname(fileURLToPath(import.meta.url));

function run(overrides = {}) {
  return {
    id: 1,
    head_sha: SHA,
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-10-03T00:00:00Z',
    ...overrides,
  };
}

function jobs(conclusion = 'success') {
  return windowsQualityJobNames().map((name) => ({ name, conclusion }));
}

test('the Windows quality jobs are the static, unit and application shard names', async () => {
  const workflow = await readFile(join(scripts, '../../../.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /name: Static checks\n/);
  assert.match(workflow, /name: Unit tests \(\$\{\{ matrix\.os \}\}\)\n/);
  assert.match(
    workflow,
    /name: Application tests \(\$\{\{ matrix\.os \}\}, shard \$\{\{ matrix\.shard \}\} of 2\)\n/,
  );
  assert.match(workflow, /shard: \[1, 2\]\n/);
  assert.deepEqual(windowsQualityJobNames(), [
    'Static checks',
    'Unit tests (windows-latest)',
    'Application tests (windows-latest, shard 1 of 2)',
    'Application tests (windows-latest, shard 2 of 2)',
  ]);
});

test('an older success does not cover a newer in-progress or failed run', () => {
  const older = run({ id: 10, created_at: '2026-10-03T00:00:00Z' });
  assert.equal(
    selectCoveringRun(
      [
        run({
          id: 11,
          status: 'in_progress',
          conclusion: null,
          created_at: '2026-10-03T01:00:00Z',
        }),
        older,
      ],
      SHA,
    ),
    null,
  );
  assert.equal(
    selectCoveringRun(
      [run({ id: 12, conclusion: 'failure', created_at: '2026-10-03T02:00:00Z' }), older],
      SHA,
    ),
    null,
  );
  assert.equal(selectCoveringRun([run({ head_sha: 'other' })], SHA), null);
  assert.equal(selectCoveringRun([older], SHA)?.id, 10);
});

test('every Windows quality job must have succeeded', () => {
  assert.equal(jobsCoverWindowsQuality(jobs()), true);
  assert.equal(jobsCoverWindowsQuality(jobs().slice(1)), false);
  const failed = jobs();
  failed[2] = { ...failed[2], conclusion: 'failure' };
  assert.equal(jobsCoverWindowsQuality(failed), false);
  assert.equal(
    jobsCoverWindowsQuality([
      ...jobs(),
      { name: 'Application tests (macos-latest, shard 1 of 2)', conclusion: 'failure' },
    ]),
    true,
  );
});

test('the command line fails closed when the jobs page is incomplete', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'koma-ci-quality-'));
  try {
    const script = join(scripts, 'ci-quality.mjs');
    const runs = join(directory, 'runs.json');
    const jobsFile = join(directory, 'jobs.json');
    await writeFile(
      runs,
      JSON.stringify({
        workflow_runs: [run({ id: 10, created_at: '2026-10-03T00:00:00Z' })],
      }),
    );
    const selected = spawnSync(process.execPath, [script, 'select-run', runs, SHA], {
      encoding: 'utf8',
    });
    assert.equal(selected.status, 0);
    assert.equal(selected.stdout, '10\n');

    const other = spawnSync(process.execPath, [script, 'select-run', runs, 'missing'], {
      encoding: 'utf8',
    });
    assert.equal(other.status, 0);
    assert.equal(other.stdout, '');

    await writeFile(
      jobsFile,
      JSON.stringify({
        total_count: windowsQualityJobNames().length + 1,
        jobs: jobs(),
      }),
    );
    const incomplete = spawnSync(process.execPath, [script, 'covers-windows', jobsFile], {
      encoding: 'utf8',
    });
    assert.equal(incomplete.status, 0);
    assert.equal(incomplete.stdout, 'false\n');

    const usage = spawnSync(process.execPath, [script, 'unknown'], { encoding: 'utf8' });
    assert.equal(usage.status, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
