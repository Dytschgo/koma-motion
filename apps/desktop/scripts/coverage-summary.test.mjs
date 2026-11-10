import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { areaOf, renderCoverage } from '../../../scripts/coverage-summary.mjs';

const scripts = import.meta.dirname;
const counts = (covered, total) => ({ covered, total, skipped: 0, pct: (covered / total) * 100 });
const entry = (covered, total) => ({
  statements: counts(covered, total),
  branches: counts(covered, total),
  functions: counts(covered, total),
  lines: counts(covered, total),
});

test('files are attributed to their package or desktop area on both path styles', () => {
  assert.equal(areaOf('/repo/packages/core/src/ids.ts', '/repo/'), 'packages/core');
  assert.equal(
    areaOf('D:\\Repo\\apps\\desktop\\src\\renderer\\src\\App.tsx', 'd:\\repo\\'),
    'apps/desktop/src/renderer',
  );
  assert.equal(areaOf('/repo/vitest.config.ts', '/repo/'), 'other');
});

test('the table adds counts per area instead of averaging file percentages', () => {
  const table = renderCoverage(
    {
      total: entry(55, 110),
      '/repo/packages/core/src/small.ts': entry(10, 10),
      '/repo/packages/core/src/large.ts': entry(40, 90),
      '/repo/apps/desktop/src/main/index.ts': entry(5, 10),
    },
    '/repo/',
  );
  assert.match(table, /\| `packages\/core` \| 50\.00 \| 50\.00 \| 50\.00 \| 50\.00 \|/);
  assert.match(table, /\| `apps\/desktop\/src\/main` \| 50\.00 \|/);
  assert.match(table, /\| \*\*All files\*\* \| 50\.00 \|/);
});

test('coverage has a floor, a script and a CI step that reports it on both platforms', async () => {
  const root = join(scripts, '../../..');
  const config = await readFile(join(root, 'vitest.config.ts'), 'utf8');
  assert.match(config, /provider: 'v8'/);
  for (const metric of ['statements', 'branches', 'functions', 'lines']) {
    const floor = new RegExp(`${metric}: (\\d+)`).exec(config);
    assert.ok(floor !== null && Number(floor[1]) > 0, `${metric} has no threshold`);
  }
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.match(manifest.scripts['test:coverage'], /vitest run --coverage/);
  assert.match(manifest.scripts['test:coverage'], /test:scripts/);
  const workflow = await readFile(join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(
    workflow,
    /name: Run unit tests\n\s+run: pnpm test:coverage && node scripts\/coverage-summary\.mjs\n/,
  );
});
