/**
 * Prints the unit-test coverage per package as a Markdown table and, on
 * GitHub Actions, appends it to the job summary.
 *
 *   node scripts/coverage-summary.mjs [coverage/coverage-summary.json]
 *
 * The input is the `json-summary` report that `pnpm test:coverage` writes.
 */
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const METRICS = ['statements', 'branches', 'functions', 'lines'];

/** The package of a source file, or the area of the desktop application. */
export function areaOf(file, root = repositoryRoot) {
  const path = file.replaceAll('\\', '/');
  const base = root.replaceAll('\\', '/').replace(/\/$/, '');
  const relative = path.toLowerCase().startsWith(`${base.toLowerCase()}/`)
    ? path.slice(base.length + 1)
    : path;
  const match = /^(packages\/[^/]+|apps\/desktop\/src\/[^/]+)\//.exec(relative);
  return match?.[1] ?? 'other';
}

/** Adds the covered and total counts of every file to its area. */
export function summarizeCoverage(summary, root = repositoryRoot) {
  const areas = new Map();
  for (const [file, entry] of Object.entries(summary)) {
    if (file === 'total') continue;
    const area = areaOf(file, root);
    const sums = areas.get(area) ?? Object.fromEntries(METRICS.map((metric) => [metric, [0, 0]]));
    for (const metric of METRICS) {
      sums[metric][0] += entry[metric].covered;
      sums[metric][1] += entry[metric].total;
    }
    areas.set(area, sums);
  }
  return [...areas.entries()].sort(([left], [right]) => left.localeCompare(right));
}

const percent = ([covered, total]) =>
  total === 0 ? '100.00' : ((covered / total) * 100).toFixed(2);

export function renderCoverage(summary, root = repositoryRoot) {
  const rows = summarizeCoverage(summary, root).map(
    ([area, sums]) =>
      `| \`${area}\` | ${METRICS.map((metric) => percent(sums[metric])).join(' | ')} |`,
  );
  const total = METRICS.map((metric) => summary.total[metric].pct.toFixed(2)).join(' | ');
  return [
    '### Unit-test coverage',
    '',
    '| Area | Statements % | Branches % | Functions % | Lines % |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...rows,
    `| **All files** | ${total} |`,
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const input = resolve(process.argv[2] ?? 'coverage/coverage-summary.json');
  const table = renderCoverage(JSON.parse(await readFile(input, 'utf8')));
  console.log(table);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, table);
}
