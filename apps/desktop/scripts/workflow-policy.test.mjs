/**
 * Conventions that every workflow in .github/workflows must keep. See
 * "Workflow and dependency policy" in docs/RELEASES.md.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scripts = dirname(fileURLToPath(import.meta.url));
const github = join(scripts, '../../../.github');
const workflowDirectory = join(github, 'workflows');

/** A repository action at a full commit SHA, followed by its exact version. */
const PINNED = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40} # v\d+\.\d+\.\d+$/;

/** Every `uses:` value of a workflow, with the comment behind it. */
export function actionReferences(workflow) {
  return workflow
    .split('\n')
    .map((line) => /^\s*(?:- )?uses:\s*(.*)$/.exec(line.replace(/\r$/, '')))
    .filter(Boolean)
    .map((match) => match[1].trim());
}

/** References that a tag or branch could redirect. Local actions are exempt. */
export function unpinnedActionReferences(workflow) {
  return actionReferences(workflow).filter(
    (reference) => !reference.startsWith('./') && !PINNED.test(reference),
  );
}

/** The text of each job, by job id. */
function jobBlocks(workflow) {
  const body = workflow.split(/^jobs:\n/m)[1];
  assert.ok(body, 'The workflow has no jobs.');
  const blocks = new Map();
  let current = null;
  for (const line of body.split('\n')) {
    const header = /^ {2}([\w-]+):\s*$/.exec(line);
    if (header) {
      current = header[1];
      blocks.set(current, '');
    } else if (current) {
      blocks.set(current, `${blocks.get(current)}${line}\n`);
    }
  }
  return blocks;
}

async function workflows() {
  const names = (await readdir(workflowDirectory)).filter((name) => /\.ya?ml$/.test(name)).sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      text: await readFile(join(workflowDirectory, name), 'utf8'),
    })),
  );
}

test('the check covers every workflow, including code scanning', async () => {
  const names = (await workflows()).map((workflow) => workflow.name);
  for (const expected of ['ci.yml', 'codeql.yml', 'nightly.yml', 'release.yml']) {
    assert.ok(names.includes(expected), `${expected} is missing.`);
  }
});

test('a tag, a branch or a short SHA is not accepted as a pinned action', () => {
  const sha = '3d3c42e5aac5ba805825da76410c181273ba90b1';
  const accepted = [
    `      - uses: actions/checkout@${sha} # v7.0.1`,
    `        uses: github/codeql-action/init@${sha} # v4.39.3`,
    '      - uses: ./.github/actions/local',
  ].join('\n');
  assert.deepEqual(unpinnedActionReferences(accepted), []);
  assert.equal(actionReferences(accepted).length, 3);

  const rejected = [
    'actions/checkout@v7',
    'actions/checkout@v7.0.1',
    'actions/checkout@main',
    `actions/checkout@${sha.slice(0, 7)} # v7.0.1`,
    `actions/checkout@${sha.toUpperCase()} # v7.0.1`,
    `actions/checkout@${sha}`,
    `actions/checkout@${sha} # v7`,
    `actions/checkout@${sha} # main`,
    'actions/checkout',
    'docker://alpine:3.20',
  ];
  for (const reference of rejected) {
    assert.deepEqual(
      unpinnedActionReferences(`      - uses: ${reference}\n`),
      [reference],
      reference,
    );
    assert.deepEqual(
      unpinnedActionReferences(`        uses: ${reference}\r\n`),
      [reference],
      reference,
    );
  }
});

test('every workflow pins its actions to a full commit SHA with a version comment', async () => {
  let references = 0;
  for (const { name, text } of await workflows()) {
    references += actionReferences(text).length;
    assert.ok(actionReferences(text).length > 0, `${name} uses no action.`);
    assert.deepEqual(
      unpinnedActionReferences(text),
      [],
      `${name} must use owner/action@<40-character commit SHA> # vX.Y.Z`,
    );
  }
  assert.ok(references > 0);
});

test('one action is pinned to one commit across all workflows', async () => {
  const commits = new Map();
  for (const { name, text } of await workflows()) {
    for (const reference of actionReferences(text)) {
      if (reference.startsWith('./')) continue;
      const [action, pin] = reference.split('@');
      const repository = action.split('/').slice(0, 2).join('/');
      const known = commits.get(repository);
      assert.ok(!known || known === pin, `${name} pins ${repository} differently: ${pin}`);
      commits.set(repository, pin);
    }
  }
});

test('every workflow starts read-only, has a concurrency group and bounds each job', async () => {
  for (const { name, text } of await workflows()) {
    assert.match(text, /^permissions:\n {2}contents: read\n(?! )/m, `${name}: permissions`);
    assert.match(text, /^concurrency:\n {2}group: \S/m, `${name}: concurrency`);
    const jobs = jobBlocks(text);
    assert.ok(jobs.size > 0, `${name} has no jobs.`);
    for (const [job, block] of jobs) {
      assert.match(block, /^ {4}timeout-minutes: \d+$/m, `${name}: ${job} has no timeout`);
      assert.doesNotMatch(block, /^ {4}permissions: write-all$/m, `${name}: ${job}`);
    }
  }
});

test('only the named jobs hold a permission beyond reading the repository', async () => {
  const elevated = {};
  for (const { name, text } of await workflows()) {
    for (const [job, block] of jobBlocks(text)) {
      const permissions = /^ {4}permissions:\n((?: {6}.*\n)+)/m.exec(block);
      if (!permissions) continue;
      const granted = permissions[1]
        .split('\n')
        .map((line) => line.replace(/#.*$/, '').trim())
        .filter((line) => line && line !== 'contents: read');
      if (granted.length > 0) elevated[`${name}:${job}`] = granted;
    }
  }
  assert.deepEqual(elevated, {
    'codeql.yml:analyze': ['security-events: write'],
    'nightly.yml:ci-coverage': ['actions: read'],
    'nightly.yml:publish': ['contents: write'],
    'release.yml:ci-coverage': ['actions: read'],
    'release.yml:promote-latest': ['contents: write'],
    'release.yml:publish': ['contents: write'],
  });
});

test('code scanning covers the application code and the workflows', async () => {
  const workflow = await readFile(join(workflowDirectory, 'codeql.yml'), 'utf8');
  assert.match(workflow, /language: \[javascript-typescript, actions\]\n/);
  assert.match(workflow, /\n {2}push:\n {4}branches: \[main\]\n/);
  assert.match(workflow, /\n {2}pull_request:\n {4}branches: \[main\]\n/);
  assert.match(workflow, /\n {2}schedule:\n(?: {4}#.*\n)* {4}- cron: /);
  assert.match(workflow, /github\/codeql-action\/init@/);
  assert.match(workflow, /github\/codeql-action\/analyze@/);
});

test('Dependabot updates packages and actions weekly, after a cooldown', async () => {
  const config = await readFile(join(github, 'dependabot.yml'), 'utf8');
  const entries = config.split(/\n {2}- package-ecosystem: /).slice(1);
  assert.deepEqual(entries.map((entry) => entry.split('\n')[0]).sort(), ['github-actions', 'npm']);
  for (const entry of entries) {
    assert.match(entry, /\n {4}directory: \/\n/);
    assert.match(entry, /\n {6}interval: weekly\n/);
    assert.match(entry, /\n {4}open-pull-requests-limit: [1-9]\d?\n/);
    // pnpm refuses packages that are younger than one day.
    const cooldown = /\n {4}cooldown:\n {6}default-days: (\d+)\n/.exec(entry);
    assert.ok(cooldown && Number(cooldown[1]) >= 2, 'The cooldown must exceed one day.');
    assert.match(entry, /\n {4}groups:\n/);
  }
  const npm = entries.find((entry) => entry.startsWith('npm'));
  assert.match(
    npm,
    /- dependency-name: typescript\n {8}update-types:\n {10}- version-update:semver-major\n {10}- version-update:semver-minor\n/,
  );
  for (const pinned of ['electron-updater', 'pdfjs-dist']) {
    assert.ok(npm.includes(`\n          - ${pinned}\n`), `${pinned} must stay out of the group.`);
    assert.doesNotMatch(npm, new RegExp(`dependency-name: ${pinned}`));
  }
});
