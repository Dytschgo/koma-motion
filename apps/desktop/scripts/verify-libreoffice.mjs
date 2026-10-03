/** Required, non-live LibreOffice coverage. This driver can also verify a historical candidate. */
import { spawnSync } from 'node:child_process';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_TITLES = [
  'prepare pptx, review/edit, save without changing project, and explicitly apply',
  'cancel discards analysis; library failure retains reviewed edits for retry',
  'discloses the selected sample and rejects too many pages and invalid PDFs',
  'normal shutdown cancels LibreOffice and removes isolated deck files',
  'prepares a PPTX with LibreOffice alongside an image',
];

export function verifyReport(report) {
  const specs = [];
  const visit = (suite) => {
    specs.push(...(suite.specs ?? []));
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites ?? []) visit(suite);
  if (specs.length !== REQUIRED_TITLES.length)
    throw new Error('Required LibreOffice scenarios are missing or duplicated.');
  for (const title of REQUIRED_TITLES) {
    const matching = specs.filter((spec) => spec.title === title);
    const tests = matching[0]?.tests;
    if (
      matching.length !== 1 ||
      tests?.length !== 1 ||
      tests[0].status !== 'expected' ||
      !tests[0].results?.some((result) => result.status === 'passed')
    ) {
      throw new Error(`LibreOffice coverage failed, skipped, retried or missing: ${title}`);
    }
  }
  return `Required LibreOffice scenarios: ${REQUIRED_TITLES.length} passed; none skipped or flaky.\n`;
}

async function main() {
  const root = resolve(process.argv[2] ?? '.');
  const output = resolve(root, process.argv[3] ?? 'test-results/libreoffice');
  const executable = process.env.KOMA_LIBREOFFICE_EXECUTABLE;
  if (!executable || !isAbsolute(executable) || !existsSync(executable))
    throw new Error(
      'Required LibreOffice executable is missing; integration coverage cannot skip.',
    );
  if (Object.keys(process.env).some((name) => name.startsWith('KOMA_LIVE_')))
    throw new Error('Live-provider variables are not allowed in this integration lane.');
  const versionCommand =
    process.platform === 'win32' ? executable.replace(/\.exe$/i, '.com') : executable;
  const version = spawnSync(versionCommand, ['--version'], { encoding: 'utf8', timeout: 30000 });
  const expected = process.env.KOMA_EXPECT_LIBREOFFICE_VERSION ?? '26.2.6';
  if (version.status !== 0 || !version.stdout.startsWith(`LibreOffice ${expected}.`))
    throw new Error(`Wrong or unreadable LibreOffice version: ${version.stdout} ${version.stderr}`);
  console.log(version.stdout.trim());
  for (const file of ['e2e/deckBrandKit.spec.ts', 'e2e/brandProfile.spec.ts']) {
    if (!existsSync(join(root, file)))
      throw new Error(`Candidate lacks required LibreOffice test file: ${file}`);
  }
  await mkdir(output, { recursive: true });
  const reportPath = join(output, 'report.json');
  const grep = REQUIRED_TITLES.map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(
    '|',
  );
  const environment = {
    ...process.env,
    KOMA_REQUIRE_LIBREOFFICE: '1',
    PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/@playwright/test/cli.js'),
      'test',
      'deckBrandKit.spec.ts',
      'brandProfile.spec.ts',
      '--grep',
      grep,
      '--reporter=list,json',
      '--output',
      output,
    ],
    { cwd: root, env: environment, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Required LibreOffice tests failed with exit code ${result.status}.`);
  const summary = verifyReport(JSON.parse(await readFile(reportPath, 'utf8')));
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
