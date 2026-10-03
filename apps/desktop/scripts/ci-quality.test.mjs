import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  jobsCoverQuality,
  selectCoveringRun,
  summarizePlaywrightReport,
  qualityJobNames,
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
  return qualityJobNames().map((name) => ({ name, conclusion }));
}

test('the Windows and macOS quality jobs are the static, unit and application shard names', async () => {
  const workflow = await readFile(join(scripts, '../../../.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /name: Static checks\n/);
  assert.match(workflow, /name: Unit tests \(\$\{\{ matrix\.os \}\}\)\n/);
  assert.match(
    workflow,
    /name: Application tests \(\$\{\{ matrix\.os \}\}, shard \$\{\{ matrix\.shard \}\} of 2\)\n/,
  );
  assert.match(workflow, /shard: \[1, 2\]\n/);
  assert.deepEqual(qualityJobNames(), [
    'Static checks',
    'LibreOffice integration (windows)',
    'Unit tests (windows-latest)',
    'Application tests (windows-latest, shard 1 of 2)',
    'Application tests (windows-latest, shard 2 of 2)',
    'Unit tests (macos-latest)',
    'Application tests (macos-latest, shard 1 of 2)',
    'Application tests (macos-latest, shard 2 of 2)',
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
  assert.equal(selectCoveringRun([], SHA), null);
  assert.equal(selectCoveringRun([run({ head_sha: 'other' })], SHA), null);
  assert.equal(selectCoveringRun([older], SHA)?.id, 10);
});

test('every Windows and macOS quality job must have succeeded', () => {
  assert.equal(jobsCoverQuality(jobs()), true);
  assert.equal(jobsCoverQuality(jobs().slice(1)), false);
  assert.equal(jobsCoverQuality(jobs().filter((job) => !job.name.includes('macos'))), false);
  assert.equal(jobsCoverQuality(jobs().filter((job) => !job.name.includes('LibreOffice'))), false);
  for (const conclusion of ['failure', 'skipped', 'cancelled', null]) {
    assert.equal(
      jobsCoverQuality(
        jobs().map((job) => (job.name.includes('macos') ? { ...job, conclusion } : job)),
      ),
      false,
    );
  }
  const failed = jobs();
  failed[2] = { ...failed[2], conclusion: 'failure' };
  assert.equal(jobsCoverQuality(failed), false);
  assert.equal(
    jobsCoverQuality([
      ...jobs(),
      { name: 'Application tests (macos-latest, shard 1 of 2)', conclusion: 'failure' },
    ]),
    false,
  );
});

test('LibreOffice lanes provision the pinned tool, preserve current policy for candidates and gate publication', async () => {
  for (const filename of ['ci.yml', 'release.yml', 'nightly.yml']) {
    const workflow = await readFile(join(scripts, '../../../.github/workflows', filename), 'utf8');
    const lane = workflow.split('\n  libreoffice:\n')[1].split('\n  package:\n')[0];
    assert.match(lane, /name: LibreOffice integration \(windows\)/);
    assert.match(lane, /runs-on: windows-latest/);
    assert.match(lane, /provision-libreoffice\.ps1/);
    assert.match(lane, /verify-libreoffice\.mjs/);
    assert.match(lane, /if: always\(\)/);
    assert.match(lane, /test-results\/libreoffice/);
    if (filename !== 'ci.yml') {
      const policy = lane.indexOf('ref: ${{ github.workflow_sha }}');
      const preserve = lane.indexOf(
        'Copy-Item -LiteralPath apps/desktop/scripts/verify-libreoffice.mjs',
      );
      const candidate = lane.indexOf('ref: ${{ needs.');
      assert.ok(policy >= 0 && preserve > policy && candidate > preserve);
      assert.match(
        lane,
        /needs\.ci-coverage\.result != 'success' \|\| needs\.ci-coverage\.outputs\.covered != 'true'/,
      );
    }
  }
  const provisioner = await readFile(join(scripts, 'provision-libreoffice.ps1'), 'utf8');
  assert.match(provisioner, /\$version = '26\.2\.6'/);
  assert.match(provisioner, /Get-FileHash -LiteralPath \$installer -Algorithm SHA256/);
  assert.match(provisioner, /download\.documentfoundation\.org\/libreoffice\/stable/);
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
        total_count: qualityJobNames().length + 1,
        jobs: jobs(),
      }),
    );
    const incomplete = spawnSync(process.execPath, [script, 'covers-quality', jobsFile], {
      encoding: 'utf8',
    });
    assert.equal(incomplete.status, 0);
    assert.equal(incomplete.stdout, 'false\n');

    await writeFile(jobsFile, JSON.stringify({ total_count: jobs().length, jobs: jobs() }));
    const covered = spawnSync(process.execPath, [script, 'covers-quality', jobsFile], {
      encoding: 'utf8',
    });
    assert.equal(covered.status, 0);
    assert.equal(covered.stdout, 'true\n');

    const report = join(directory, 'report.json');
    const summaryFile = join(directory, 'summary.md');
    await writeFile(
      report,
      JSON.stringify({
        suites: [
          {
            specs: [{ title: 'skipped integration', tests: [{ status: 'skipped', results: [] }] }],
          },
        ],
      }),
    );
    const summary = spawnSync(process.execPath, [script, 'summarize-report', report], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: summaryFile },
    });
    assert.equal(summary.status, 0);
    assert.match(summary.stdout, /skipped: 1/);
    assert.equal(await readFile(summaryFile, 'utf8'), summary.stdout);

    const usage = spawnSync(process.execPath, [script, 'unknown'], { encoding: 'utf8' });
    assert.equal(usage.status, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('release workflows fall back on both platforms and publish only with quality evidence', async () => {
  for (const [filename, guard] of [
    ['release.yml', 'classify'],
    ['nightly.yml', 'guard'],
  ]) {
    const workflow = await readFile(join(scripts, '../../../.github/workflows', filename), 'utf8');
    const quality = workflow.split('\n  quality:\n')[1].split('\n  package:\n')[0];
    assert.match(quality, /runs-on: \$\{\{ matrix\.os \}\}/);
    assert.match(quality, /os: \[windows-latest, macos-latest\]/);
    assert.match(
      quality,
      /needs\.ci-coverage\.result != 'success' \|\| needs\.ci-coverage\.outputs\.covered != 'true'/,
    );
    assert.match(quality, /run: pnpm test\n/);
    assert.match(quality, /run: pnpm build\n/);
    assert.match(quality, /ref: \$\{\{ needs\.(classify|guard)\.outputs\.sha \}\}/);
    for (const command of ['format:check', 'lint', 'typecheck']) {
      assert.ok(
        quality.includes(`if: matrix.os == 'windows-latest'\n        run: pnpm ${command}`),
      );
    }
    assert.ok(workflow.includes(`needs: [${guard}, ci-coverage, quality, libreoffice, package]`));
    assert.match(
      workflow,
      /needs\.libreoffice\.result == 'success' \|\| \(needs\.libreoffice\.result == 'skipped' && needs\.ci-coverage\.outputs\.covered == 'true'\)/,
    );
    assert.ok(workflow.includes(`needs.${guard}.result == 'success'`));
    assert.match(workflow, /needs\.package\.result == 'success'/);
    assert.match(
      workflow,
      /needs\.quality\.result == 'success' \|\| \(needs\.quality\.result == 'skipped' && needs\.ci-coverage\.outputs\.covered == 'true'\)/,
    );
    assert.match(workflow, /koma-ci-quality\.mjs" covers-quality jobs\.json/);
    assert.match(workflow, /select-run runs\.json "\$SHA"/);
    const coverage = workflow.split('\n  ci-coverage:\n')[1].split('\n  quality:\n')[0];
    for (const block of [coverage, quality]) {
      const policyIndex = block.indexOf('ref: ${{ github.workflow_sha }}');
      const copyIndex = block.indexOf(
        'cp apps/desktop/scripts/ci-quality.mjs "$RUNNER_TEMP/koma-ci-quality.mjs"',
      );
      const candidateIndex = block.indexOf('ref: ${{ needs.' + guard + '.outputs.sha }}');
      assert.ok(policyIndex >= 0 && copyIndex > policyIndex && candidateIndex > copyIndex);
      assert.doesNotMatch(block, /run: node apps\/desktop\/scripts\/ci-quality\.mjs/);
    }
    assert.match(quality, /node "\$\{\{ runner\.temp \}\}\/koma-ci-quality\.mjs" summarize-report/);
  }
});

test('all application lanes retain JSON and summaries on success, without increasing native workers', async () => {
  for (const filename of ['ci.yml', 'release.yml', 'nightly.yml']) {
    const workflow = await readFile(join(scripts, '../../../.github/workflows', filename), 'utf8');
    assert.match(workflow, /PLAYWRIGHT_JSON_OUTPUT_NAME: test-results\/report\.json/);
    assert.match(workflow, /"--reporter=list,github,json"/);
    assert.match(
      workflow,
      /Summarize retries and skipped tests\n\s+if: always\(\) && steps\.application\.outcome != 'skipped'/,
    );
    assert.match(workflow, /Keep application test reports and traces\n\s+if: always\(\)/);
    assert.doesNotMatch(workflow, /--workers/);
  }
  const config = await readFile(join(scripts, '../playwright.config.ts'), 'utf8');
  assert.match(config, /workers: 1,/);
  assert.match(config, /fullyParallel: false,/);
});

test('report summaries identify retries and intentional skips, including nested suites', () => {
  const report = {
    suites: [
      {
        title: 'workflow.spec.ts',
        suites: [
          {
            title: 'project workflow',
            specs: [
              {
                title: 'first pass',
                tests: [{ status: 'expected', results: [{ retry: 0, status: 'passed' }] }],
              },
              {
                title: 'retry pass',
                tests: [
                  {
                    status: 'flaky',
                    results: [
                      { retry: 0, status: 'failed' },
                      { retry: 1, status: 'passed' },
                    ],
                  },
                ],
              },
              {
                title: 'LibreOffice',
                tests: [
                  {
                    status: 'skipped',
                    annotations: [{ type: 'skip', description: 'LibreOffice required' }],
                    results: [{ retry: 0, status: 'skipped' }],
                  },
                ],
              },
              {
                title: 'failed',
                tests: [
                  {
                    status: 'unexpected',
                    results: [
                      { retry: 0, status: 'failed' },
                      { retry: 1, status: 'failed' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const summary = summarizePlaywrightReport(report);
  assert.match(summary, /Expected: 1; unexpected: 1; flaky: 1; skipped: 1/);
  assert.match(
    summary,
    /flaky: workflow\.spec\.ts › project workflow › retry pass \(attempt 1: failed, attempt 2: passed\)/,
  );
  assert.match(summary, /skipped: .*LibreOffice.*LibreOffice required/);
  assert.match(summary, /unexpected: .*attempt 2: failed/);
  assert.doesNotMatch(summary, /first pass/);
  assert.throws(
    () => summarizePlaywrightReport({ suites: [{ specs: [{ tests: [{ status: 'unknown' }] }] }] }),
    /Unknown Playwright/,
  );
});
