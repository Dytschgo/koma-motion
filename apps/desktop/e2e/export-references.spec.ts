import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildKoma, buildProject, buildShape } from '@koma-motion/core/testing';
import { buildTransition } from '@koma-motion/motion-engine';
import { expect, test } from '@playwright/test';
import { fromBuffer, type Entry, type ZipFile } from 'yauzl';
import {
  answerOpenDialog,
  answerSaveDialog,
  launchApplication,
  type RunningApplication,
} from './application';
import { selectProvider } from './composerControls';

let running: RunningApplication;

test.beforeEach(async () => {
  running = await launchApplication();
});

test.afterEach(async () => {
  await running.close();
});

async function pptxParts(path: string): Promise<Map<string, string>> {
  const bytes = await readFile(path);
  const zip = await new Promise<ZipFile>((resolveZip, reject) => {
    fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, result) => {
      if (error || !result) reject(error ?? new Error('Could not read PPTX archive.'));
      else resolveZip(result);
    });
  });
  const parts = new Map<string, string>();
  return new Promise<Map<string, string>>((resolveParts, reject) => {
    const fail = (error: unknown): void => {
      zip.close();
      reject(error instanceof Error ? error : new Error('Could not read PPTX entry.'));
    };
    zip.on('error', fail);
    zip.on('end', () => resolveParts(parts));
    zip.on('entry', (entry: Entry) => {
      if (
        !/^ppt\/slides\/slide\d+\.xml$|^ppt\/presentation\.xml$|^\[Content_Types\]\.xml$/.test(
          entry.fileName,
        )
      ) {
        zip.readEntry();
        return;
      }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) {
          fail(error);
          return;
        }
        const chunks: Buffer[] = [];
        stream.on('error', fail);
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => {
          parts.set(entry.fileName, Buffer.concat(chunks).toString('utf8'));
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  });
}

async function createMockPresentation(): Promise<void> {
  const { window } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await window.getByRole('button', { name: 'Use the example request' }).click();
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  await expect(
    window.getByRole('list', { name: 'Komas' }).getByRole('button', { name: /^Koma \d:/ }),
  ).toHaveCount(3);
}

test('exports static slides and a motion fallback through the native destination without changing the project', async () => {
  const { window, application, directory, problems } = running;
  await createMockPresentation();
  const projectPath = join(directory, 'source.koma');
  await answerSaveDialog(application, projectPath);
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('All changes saved')).toBeVisible();
  const projectBefore = await readFile(projectPath);

  const staticPath = join(directory, 'static.pptx');
  await window.getByRole('button', { name: 'Export', exact: true }).click();
  const exportDialog = window.getByRole('dialog', { name: 'Export PowerPoint' });
  await expect(exportDialog).toContainText('Export 3 Komas as editable PowerPoint slides');
  await expect(exportDialog.getByLabel('Motion')).toHaveValue('static');
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 800);
  });
  await expect(exportDialog.getByRole('button', { name: 'Choose destination' })).toBeInViewport({
    ratio: 1,
  });
  await expect(
    exportDialog.getByRole('checkbox', {
      name: 'Advance automatically using Koma hold durations',
    }),
  ).toBeInViewport({ ratio: 1 });
  await window.screenshot({ path: test.info().outputPath('export-modal-1120x800.png') });
  await answerSaveDialog(application, staticPath);
  await exportDialog.getByRole('button', { name: 'Choose destination' }).click();
  await expect(exportDialog.getByRole('status')).toContainText('Exported static.pptx');
  const staticParts = await pptxParts(staticPath);
  expect(staticParts.has('[Content_Types].xml')).toBe(true);
  expect(
    [...staticParts.keys()].filter((key) => /^ppt\/slides\/slide\d+\.xml$/.test(key)),
  ).toHaveLength(3);
  const first = staticParts.get('ppt/slides/slide1.xml') ?? '';
  const second = staticParts.get('ppt/slides/slide2.xml') ?? '';
  expect(first).toContain('<p:sp>');
  expect(first).toContain('<a:t>');
  expect(first).toContain('!!motion-engine');
  expect(second).toContain('!!motion-engine');
  expect(second).not.toContain('<p159:morph');
  await exportDialog.getByRole('button', { name: 'Close' }).click();

  const morphPath = join(directory, 'morph.pptx');
  await window.getByRole('button', { name: 'Export', exact: true }).click();
  await exportDialog.getByLabel('Motion').selectOption('morph');
  await exportDialog
    .getByRole('checkbox', { name: 'Advance automatically using Koma hold durations' })
    .check();
  await exportDialog.getByLabel('Global export hold duration in seconds').fill('3.5');
  await answerSaveDialog(application, morphPath);
  await exportDialog.getByRole('button', { name: 'Choose destination' }).click();
  await expect(exportDialog.getByRole('status')).toContainText('Exported morph.pptx');
  const morphParts = await pptxParts(morphPath);
  expect(morphParts.get('ppt/slides/slide2.xml')).toContain('<p:fade/>');
  expect(morphParts.get('ppt/slides/slide2.xml')).not.toContain('<p159:morph');
  expect(morphParts.get('ppt/slides/slide2.xml')).toContain('p14:dur=');
  expect(morphParts.get('ppt/slides/slide1.xml')).toContain('advTm="3500"');
  await expect(exportDialog.getByRole('list', { name: 'Export warnings' })).toContainText(
    'is exported as a slide fade',
  );
  await exportDialog.getByRole('button', { name: 'Close' }).click();

  const filesBeforeCancel = (await readdir(directory)).sort();
  await window.getByRole('button', { name: 'Export', exact: true }).click();
  await application.evaluate(({ dialog }) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: true, filePath: '' });
  });
  await exportDialog.getByRole('button', { name: 'Choose destination' }).click();
  await expect(exportDialog.getByRole('button', { name: 'Choose destination' })).toBeEnabled();
  expect((await readdir(directory)).sort()).toEqual(filesBeforeCancel);
  expect(await readFile(projectPath)).toEqual(projectBefore);
  await expect(window.getByText('All changes saved')).toBeVisible();
  expect(problems).toEqual([]);
});

test('exports a continuous Koma move as named editable Morph objects', async () => {
  const { window, application, directory, problems } = running;
  const komas = [100, 400, 700].map((x, index) =>
    buildKoma({
      id: `morph-koma-${index + 1}`,
      title: `Position ${index + 1}`,
      elements: [
        buildShape({
          id: `morph-shape-${index + 1}`,
          persistentId: 'moving-object',
          position: { x, y: 250 },
        }),
      ],
    }),
  );
  const first = buildTransition({
    id: 'morph-transition-1',
    from: komas[0]!,
    to: komas[1]!,
    suggestion: { strategy: 'continuous', duration: 900 },
  });
  const second = buildTransition({
    id: 'morph-transition-2',
    from: komas[1]!,
    to: komas[2]!,
    suggestion: { strategy: 'continuous', duration: 1200 },
  });
  if (!first.ok || !second.ok) throw new Error('The Morph fixture could not be built.');
  const project = buildProject({
    presentation: {
      ...buildProject().presentation,
      komas,
      transitions: [first.value.transition, second.value.transition],
    },
  });
  const source = join(directory, 'continuous.koma');
  const exported = join(directory, 'continuous.pptx');
  await writeFile(source, JSON.stringify(project), 'utf8');
  await answerOpenDialog(application, source);
  await window.getByRole('button', { name: 'Open a project' }).click();
  await expect(
    window.getByRole('list', { name: 'Komas' }).getByRole('button', { name: /^Koma \d:/ }),
  ).toHaveCount(3);
  await window.getByRole('button', { name: 'Export', exact: true }).click();
  const exportDialog = window.getByRole('dialog', { name: 'Export PowerPoint' });
  await exportDialog.getByLabel('Motion').selectOption('morph');
  await answerSaveDialog(application, exported);
  await exportDialog.getByRole('button', { name: 'Choose destination' }).click();
  await expect(exportDialog.getByRole('status')).toContainText('Exported continuous.pptx');
  const parts = await pptxParts(exported);
  for (const number of [1, 2, 3]) {
    expect(parts.get(`ppt/slides/slide${number}.xml`)).toContain('!!moving-object');
  }
  expect(parts.get('ppt/slides/slide2.xml')).toContain('<p159:morph option="byObject"/>');
  expect(parts.get('ppt/slides/slide2.xml')).toContain('p14:dur="900"');
  expect(parts.get('ppt/slides/slide3.xml')).toContain('<p159:morph option="byObject"/>');
  expect(parts.get('ppt/slides/slide3.xml')).toContain('p14:dur="1200"');
  expect(problems).toEqual([]);
});

test('previews, removes and rejects text references; save and reopen do not retain them', async () => {
  const { window, application, directory, problems } = running;
  const txt = join(directory, 'brief.txt');
  const md = join(directory, 'notes.md');
  const invalid = join(directory, 'invalid.txt');
  const projectPath = join(directory, 'reference-free.koma');
  await writeFile(txt, 'River delta evidence for the presentation.', 'utf8');
  await writeFile(md, '# Field notes\nSecond source for the presentation.', 'utf8');
  await writeFile(invalid, Buffer.from([0, 1, 2, 3]));
  await window.getByRole('button', { name: 'Create a project' }).click();
  const references = window.getByRole('list', { name: 'Attached references' });

  await answerOpenDialog(application, txt);
  await window.getByRole('button', { name: 'Attach references' }).click();
  await expect(references.getByRole('listitem')).toHaveCount(1);
  await references.getByText(/brief.txt/).click();
  await expect(references).toContainText('River delta evidence');

  await answerOpenDialog(application, md);
  await window.getByRole('button', { name: 'Attach references' }).click();
  await expect(references.getByRole('listitem')).toHaveCount(2);
  await references.getByText(/notes.md/).click();
  await expect(references).toContainText('Second source');
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 800);
  });
  await expect(window.getByLabel('Your request')).toBeInViewport({ ratio: 1 });
  await expect(window.getByRole('button', { name: 'Generate Komas' })).toBeInViewport({ ratio: 1 });
  await expect(window.getByRole('button', { name: 'Attach references' })).toBeInViewport({
    ratio: 1,
  });
  await window.screenshot({ path: test.info().outputPath('references-composer-1120x800.png') });

  await expect(window.getByText('2 attached · session only')).toBeVisible();
  await expect(window.getByText(/not saved in the .koma project/)).toBeVisible();

  await references.getByRole('button', { name: 'Remove notes.md' }).click();
  await expect(references.getByRole('listitem')).toHaveCount(1);
  await answerOpenDialog(application, invalid);
  await window.getByRole('button', { name: 'Attach references' }).click();
  await expect(window.getByRole('alert')).toContainText('contains binary data');
  await expect(references.getByRole('listitem')).toHaveCount(1);

  await application.evaluate(({ dialog }) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: true, filePaths: [] });
  });
  await window.getByRole('button', { name: 'Attach references' }).click();
  await expect(references.getByRole('listitem')).toHaveCount(1);
  await expect(window.getByRole('alert')).toHaveCount(0);

  await answerSaveDialog(application, projectPath);
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('All changes saved')).toBeVisible();
  const saved = await readFile(projectPath, 'utf8');
  expect(saved).not.toContain('River delta evidence');
  expect(saved).not.toContain('notes.md');
  expect(saved).not.toContain(txt);
  await window.getByRole('button', { name: 'New', exact: true }).click();
  await expect(references).toHaveCount(0);
  await answerOpenDialog(application, projectPath);
  await window.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(references).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('extracts a local PDF for preview without exposing its path', async () => {
  const { window, application, problems } = running;
  const path = resolve('e2e/fixtures/decks/northstar.pdf');
  await window.getByRole('button', { name: 'Create a project' }).click();
  await answerOpenDialog(application, resolve('e2e/fixtures/decks/encrypted.pdf'));
  await window.getByRole('button', { name: 'Attach references' }).click();
  await expect(window.getByRole('alert')).toContainText('password protected');
  expect(
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
  ).toBe(1);
  await expect(window.getByRole('list', { name: 'Attached references' })).toHaveCount(0);
  await answerOpenDialog(application, path);
  await window.getByRole('button', { name: 'Attach references' }).click();
  const references = window.getByRole('list', { name: 'Attached references' });
  await expect(references.getByRole('listitem')).toHaveCount(1);
  await references.getByText(/northstar.pdf/).click();
  await expect(references).toContainText('Clear thinking');
  await expect(window.getByRole('alert')).toHaveCount(0);
  await expect(window.getByText(path, { exact: true })).toHaveCount(0);
  expect(
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
  ).toBe(1);
  expect(problems).toEqual([]);
});

test('external-provider consent follows the selected references without contacting it', async () => {
  const { window, application, directory, problems } = running;
  const first = join(directory, 'first.txt');
  const second = join(directory, 'second.md');
  await writeFile(first, 'First source text', 'utf8');
  await writeFile(second, 'Second source text', 'utf8');
  await window.getByRole('button', { name: 'Create a project' }).click();
  await answerOpenDialog(application, first);
  await window.getByRole('button', { name: 'Attach references' }).click();
  await expect(
    window.getByRole('list', { name: 'Attached references' }).getByRole('listitem'),
  ).toHaveCount(1);
  await selectProvider(window, 'claude-code');
  const consent = window.getByRole('checkbox', {
    name: 'Send the extracted reference text to Claude Code with this request.',
  });
  await expect(consent).toBeVisible();
  await expect(consent).not.toBeChecked();
  await consent.check();
  await expect(consent).toBeChecked();
  await answerOpenDialog(application, second);
  await window.getByRole('button', { name: 'Attach references' }).click();
  await expect(consent).not.toBeChecked();
  await selectProvider(window, 'mock');
  await expect(consent).toHaveCount(0);
  await expect(
    window.getByText('Mock repeats its demo and does not use reference content.'),
  ).toBeVisible();
  expect(problems).toEqual([]);
});
