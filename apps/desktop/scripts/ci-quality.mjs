/**
 * Decides whether a nightly or stable release still needs quality checks.
 * Reuse requires static checks and every Windows and macOS behavioral job.
 *
 *   node scripts/ci-quality.mjs select-run <runs.json> <sha>
 *   node scripts/ci-quality.mjs covers-quality <jobs.json>
 *   node scripts/ci-quality.mjs summarize-report <report.json>
 *
 * select-run prints the id of the newest CI run for the commit when that run
 * completed successfully, and prints nothing otherwise. covers-quality prints
 * true when the jobs of that run include every Windows and macOS quality job.
 */
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const QUALITY_JOBS = qualityJobNames();

export function qualityJobNames(shardCount = 2) {
  return [
    'Static checks',
    'LibreOffice integration (windows)',
    ...['windows-latest', 'macos-latest'].flatMap((os) => [
      `Unit tests (${os})`,
      ...Array.from(
        { length: shardCount },
        (_, index) => `Application tests (${os}, shard ${index + 1} of ${shardCount})`,
      ),
    ]),
  ];
}

/**
 * The newest run for this commit. An in-progress or failed newest run does
 * not qualify, even when an older run succeeded.
 */
export function selectCoveringRun(runs, sha) {
  const matching = runs
    .filter((run) => run.head_sha === sha)
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
  const newest = matching[0];
  if (!newest || newest.status !== 'completed' || newest.conclusion !== 'success') {
    return null;
  }
  return newest;
}

export function jobsCoverQuality(jobs, required = QUALITY_JOBS) {
  return required.every((name) => {
    const matching = jobs.filter((job) => job.name === name);
    return matching.length > 0 && matching.every((job) => job.conclusion === 'success');
  });
}

/** Preserve passing retries and intentional skips separately from first-attempt passes. */
export function summarizePlaywrightReport(report) {
  const counts = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  const details = [];
  const clean = (value) => String(value).replace(/[\r\n`]/g, ' ');
  const visit = (suite, ancestors = []) => {
    const titles = [...ancestors, suite.title].filter(Boolean);
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (!Object.hasOwn(counts, test.status)) {
          throw new Error(`Unknown Playwright test status: ${test.status}`);
        }
        counts[test.status] += 1;
        const results = test.results ?? [];
        const retried = results.some((result) => result.retry > 0);
        if (test.status === 'expected' && !retried) continue;
        const title = clean([...titles, spec.title, test.projectName].filter(Boolean).join(' › '));
        const attempts = results
          .map((result) => `attempt ${result.retry + 1}: ${result.status}`)
          .join(', ');
        const reasons = (test.annotations ?? [])
          .filter((annotation) => annotation.type === 'skip')
          .map((annotation) => clean(annotation.description ?? ''))
          .filter(Boolean)
          .join('; ');
        details.push(
          `- ${test.status}: ${title}${attempts ? ` (${attempts})` : ''}${reasons ? ` — ${reasons}` : ''}`,
        );
      }
    }
    for (const child of suite.suites ?? []) visit(child, titles);
  };
  for (const suite of report.suites) visit(suite);
  return [
    '### Application test outcomes',
    '',
    `Expected: ${counts.expected}; unexpected: ${counts.unexpected}; flaky: ${counts.flaky}; skipped: ${counts.skipped}.`,
    '',
    ...(details.length > 0 ? details : ['Every reported test passed without a retry or skip.']),
    '',
  ].join('\n');
}

async function main(argv) {
  const [command, file, sha] = argv;
  const payload = JSON.parse(await readFile(file, 'utf8'));
  if (command === 'select-run') {
    if (!sha) throw new Error('select-run needs the commit SHA.');
    const selected = selectCoveringRun(payload.workflow_runs ?? payload, sha);
    process.stdout.write(selected ? `${selected.id}\n` : '');
    return;
  }
  if (command === 'covers-quality') {
    const jobs = payload.jobs ?? payload;
    const incomplete = typeof payload.total_count === 'number' && payload.total_count > jobs.length;
    process.stdout.write(incomplete || !jobsCoverQuality(jobs) ? 'false\n' : 'true\n');
    return;
  }
  if (command === 'summarize-report') {
    const summary = summarizePlaywrightReport(payload);
    process.stdout.write(summary);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
    }
    return;
  }
  throw new Error('Usage: ci-quality.mjs select-run|covers-quality|summarize-report');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
