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
 * summarize-report writes the outcomes to the job summary and prints a warning
 * annotation for each test that passed only on a retry.
 */
import { appendFile, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
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

/**
 * The path of a spec file from the repository root, for an annotation that
 * GitHub can attach to the file. Null when the report or the runner does not
 * say where the file is.
 */
function repositoryPath(report, file, workspace) {
  const root = report.config?.rootDir;
  if (!workspace || typeof root !== 'string' || typeof file !== 'string') return null;
  const path = relative(workspace, resolve(root, file)).replaceAll('\\', '/');
  return path === '' || path.startsWith('..') || isAbsolute(path) ? null : path;
}

/**
 * Preserve passing retries and intentional skips separately from first-attempt
 * passes. A test that passed only on a retry also appears in `retried`: the
 * job stays green, so the summary and an annotation must say it.
 */
export function collectPlaywrightOutcomes(report, workspace = process.env.GITHUB_WORKSPACE) {
  const counts = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  const details = [];
  const retried = [];
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
        const hadRetry = results.some((result) => result.retry > 0);
        if (test.status === 'expected' && !hadRetry) continue;
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
        if (test.status === 'flaky') {
          retried.push({
            title,
            attempts,
            file: repositoryPath(report, spec.file, workspace),
            line: Number.isInteger(spec.line) ? spec.line : null,
          });
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child, titles);
  };
  for (const suite of report.suites) visit(suite);
  return { counts, details, retried };
}

export function summarizePlaywrightReport(report, workspace = process.env.GITHUB_WORKSPACE) {
  const { counts, details, retried } = collectPlaywrightOutcomes(report, workspace);
  return [
    '### Application test outcomes',
    '',
    `Expected: ${counts.expected}; unexpected: ${counts.unexpected}; flaky: ${counts.flaky}; skipped: ${counts.skipped}.`,
    '',
    ...(retried.length > 0
      ? [
          `#### Warning: passed only on retry (${retried.length})`,
          '',
          'The job is green, but the first attempt of each test below failed. A retry hides an',
          'intermittent failure; it does not show that the test is sound. The failed attempt and',
          "its trace are in this job's test results artifact.",
          '',
          ...retried.map(
            (test) =>
              `- ${test.file ? `\`${test.file}${test.line === null ? '' : `:${test.line}`}\` ` : ''}${test.title} (${test.attempts})`,
          ),
          '',
          '#### All retried, failed and skipped tests',
          '',
        ]
      : []),
    ...(details.length > 0 ? details : ['Every reported test passed without a retry or skip.']),
    '',
  ].join('\n');
}

/**
 * One GitHub warning annotation for each test that passed only on a retry.
 * Annotations appear on the run page and in the checks of a pull request,
 * where a green job would otherwise say nothing.
 */
export function retryAnnotations(report, workspace = process.env.GITHUB_WORKSPACE) {
  const data = (value) =>
    String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  const property = (value) => data(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
  return collectPlaywrightOutcomes(report, workspace).retried.map((test) => {
    const location = test.file
      ? `file=${property(test.file)},${test.line === null ? '' : `line=${test.line},`}`
      : '';
    return `::warning ${location}title=${property('Test passed only on retry')}::${data(
      `${test.title} (${test.attempts}). The retry hid an intermittent failure. See the job summary and the trace in the test results artifact.`,
    )}`;
  });
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
    // The runner turns these lines into annotations. They are not part of the summary.
    for (const annotation of retryAnnotations(payload)) process.stdout.write(`${annotation}\n`);
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
