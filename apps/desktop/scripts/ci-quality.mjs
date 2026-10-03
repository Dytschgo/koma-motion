/**
 * Decides whether a nightly or stable release still needs its Windows
 * quality job. That job repeats static checks, Windows unit tests and the
 * Windows application shards from CI.
 *
 *   node scripts/ci-quality.mjs select-run <runs.json> <sha>
 *   node scripts/ci-quality.mjs covers-windows <jobs.json>
 *
 * select-run prints the id of the newest CI run for the commit when that run
 * completed successfully, and prints nothing otherwise. covers-windows prints
 * true when the jobs of that run include every Windows quality job.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const WINDOWS_QUALITY_JOBS = windowsQualityJobNames();

export function windowsQualityJobNames(shardCount = 2) {
  return [
    'Static checks',
    'Unit tests (windows-latest)',
    ...Array.from(
      { length: shardCount },
      (_, index) => `Application tests (windows-latest, shard ${index + 1} of ${shardCount})`,
    ),
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

export function jobsCoverWindowsQuality(jobs, required = WINDOWS_QUALITY_JOBS) {
  return required.every((name) =>
    jobs.some((job) => job.name === name && job.conclusion === 'success'),
  );
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
  if (command === 'covers-windows') {
    const jobs = payload.jobs ?? payload;
    const incomplete = typeof payload.total_count === 'number' && payload.total_count > jobs.length;
    process.stdout.write(incomplete || !jobsCoverWindowsQuality(jobs) ? 'false\n' : 'true\n');
    return;
  }
  throw new Error('Usage: ci-quality.mjs select-run|covers-windows');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
