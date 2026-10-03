import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  GenerationRunner,
  MockAgentProvider,
  ProviderRegistry,
  type ExecutionStatusEvent,
} from '@koma-motion/agent-runtime';
import { buildResponse, ScriptedProvider } from '@koma-motion/agent-runtime/testing';
import {
  assetReferenceSchema,
  createSeededIdGenerator,
  MAX_EMBEDDED_ASSET_BYTES,
  MAX_PROJECT_FILE_BYTES,
  PROJECT_TOO_LARGE_MESSAGE,
  presentationSchema,
} from '@koma-motion/core';
import { buildProject } from '@koma-motion/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ipcContract, ipcEvents } from '../shared/ipc';
import {
  CONTENT_SECURITY_POLICY,
  externalBrowserDestination,
  isAllowedExternalLink,
  isAppUrl,
  resolveAppFile,
} from './securityPolicy';
import { generatePresentation } from './services/generation';
import { createImageAsset, detectImageType, toDisplayName } from './services/imageAsset';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
  'base64',
);

describe('resolveAppFile', () => {
  let root: string;
  let directory: string;
  let outside: string;
  const links: string[] = [];

  function writeBundle(): void {
    mkdirSync(join(directory, 'assets'));
    writeFileSync(join(directory, 'index.html'), '<!doctype html>');
    writeFileSync(join(directory, 'assets', 'index-abc.js'), 'export {};');
    writeFileSync(join(directory, 'assets', 'font.woff2'), 'woff');
    writeFileSync(join(directory, 'secret.json'), '{}');
    writeFileSync(join(outside, 'secret.html'), 'secret-html');
    writeFileSync(join(outside, 'secret.js'), 'secret-js');
    writeFileSync(join(outside, 'secret.png'), 'secret-png');
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'koma-renderer-'));
    directory = join(root, 'renderer');
    outside = join(root, 'outside');
    mkdirSync(directory);
    mkdirSync(outside);
    writeBundle();
    links.length = 0;
  });

  afterEach(() => {
    for (const link of links) {
      rmSync(link, { force: true, recursive: false });
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('serves files of the renderer bundle', () => {
    expect(resolveAppFile('koma://app/index.html', directory)).toBe(
      realpathSync(join(directory, 'index.html')),
    );
    expect(resolveAppFile('koma://app/', directory)).toBe(
      realpathSync(join(directory, 'index.html')),
    );
    expect(resolveAppFile('koma://app/assets/index-abc.js', directory)).toBe(
      realpathSync(join(directory, 'assets', 'index-abc.js')),
    );
    expect(resolveAppFile('koma://app/assets/font.woff2', directory)).toBe(
      realpathSync(join(directory, 'assets', 'font.woff2')),
    );
  });

  it('keeps encoded parent folders inside the bundle', () => {
    expect(resolveAppFile('koma://app/%2e%2e/%2e%2e/secret.json', directory)).toBe(
      realpathSync(join(directory, 'secret.json')),
    );
  });

  it('rejects a directory junction or symlink that points outside the bundle', () => {
    const link = join(directory, 'escape');
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    links.push(link);
    expect(resolveAppFile('koma://app/escape/secret.html', directory)).toBeNull();
    expect(resolveAppFile('koma://app/escape/secret.js', directory)).toBeNull();
    expect(resolveAppFile('koma://app/index.html', directory)).toBe(
      realpathSync(join(directory, 'index.html')),
    );
    expect(readFileSync(join(outside, 'secret.html'), 'utf8')).toBe('secret-html');
  });

  it('rejects a file symlink that points outside the bundle when the system allows it', () => {
    const link = join(directory, 'linked.js');
    try {
      symlinkSync(join(outside, 'secret.js'), link, 'file');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      expect(code === 'EPERM' || code === 'EACCES').toBe(true);
      return;
    }
    links.push(link);
    expect(resolveAppFile('koma://app/linked.js', directory)).toBeNull();
  });

  it('rejects alternate streams and Windows device names', () => {
    writeFileSync(join(directory, 'index.html:hidden.js'), 'hidden();');
    expect(resolveAppFile('koma://app/index.html:hidden.js', directory)).toBeNull();
    expect(resolveAppFile('koma://app/index.html%3Ahidden.js', directory)).toBeNull();
    expect(resolveAppFile('koma://app/index.html::$DATA', directory)).toBeNull();
    expect(resolveAppFile('koma://app/aux.png', directory)).toBeNull();
    expect(resolveAppFile('koma://app/NUL.js', directory)).toBeNull();
    expect(resolveAppFile('koma://app/COM1.js', directory)).toBeNull();
    expect(resolveAppFile('koma://app/index.html.', directory)).toBeNull();
    expect(resolveAppFile('koma://app/assets/font.woff2%20', directory)).toBeNull();
  });

  it.each([
    ['another host', 'koma://other/index.html'],
    ['another protocol', 'file:///application/renderer/index.html'],
    ['a parent folder', 'koma://app/../main/index.cjs'],
    ['an encoded backslash', 'koma://app/..%5C..%5Csecret.json'],
    ['a file type that is not served', 'koma://app/notes.txt'],
    ['a file without extension', 'koma://app/assets'],
    ['a NUL character', 'koma://app/index.html%00.png'],
    ['text that is not a URL', 'index.html'],
    ['a missing file', 'koma://app/missing.html'],
  ])('refuses %s', (_label, url) => {
    expect(resolveAppFile(url, directory)).toBeNull();
  });
});

describe('navigation rules', () => {
  it('recognises the application page', () => {
    expect(isAppUrl('koma://app/index.html')).toBe(true);
    expect(isAppUrl('koma://application/index.html')).toBe(false);
    expect(isAppUrl('https://example.com/koma://app/')).toBe(false);
  });

  it('opens only links of the project in the browser', () => {
    expect(externalBrowserDestination('https://github.com/Dytschgo/koma-motion')).toBe(
      'https://github.com/Dytschgo/koma-motion',
    );
    expect(
      externalBrowserDestination('https://github.com/Dytschgo/koma-motion/issues#readme'),
    ).toBe('https://github.com/Dytschgo/koma-motion/issues#readme');
    expect(isAllowedExternalLink('https://github.com/Dytschgo/koma-motion/issues')).toBe(true);
    expect(isAllowedExternalLink('https://github.com/Dytschgo/koma-motion-evil')).toBe(false);
    expect(isAllowedExternalLink('https://example.com/')).toBe(false);
    expect(isAllowedExternalLink('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(isAllowedExternalLink('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalLink('https://user:pass@github.com/Dytschgo/koma-motion')).toBe(false);
    expect(
      isAllowedExternalLink('https://github.com/Dytschgo/koma-motion?return=https://evil.test'),
    ).toBe(false);
    expect(isAllowedExternalLink('https://github.com/Dytschgo/koma-motion/..%2f..%2fother')).toBe(
      false,
    );
    expect(isAllowedExternalLink('https://github.com/Dytschgo/koma-motion\\@evil')).toBe(false);
    expect(isAllowedExternalLink('https://github.com:8443/Dytschgo/koma-motion')).toBe(false);
    expect(externalBrowserDestination('https://github.com:443/Dytschgo/koma-motion')).toBe(
      'https://github.com/Dytschgo/koma-motion',
    );
  });

  it('forbids remote content, inline scripts and eval', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/https?:/);
  });
});

describe('IPC contract', () => {
  it('is mirrored exactly by the channel lists of the preload script', async () => {
    const source = await readFile(resolve(import.meta.dirname, '../preload/index.ts'), 'utf8');
    const listed = (name: string): string[] => {
      const block = new RegExp(`const ${name}[^=]*= new Set\\(\\[([^\\]]*)\\]\\)`).exec(source);
      return [...(block?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '').sort();
    };
    expect(listed('REQUEST_CHANNELS')).toEqual(Object.keys(ipcContract).sort());
    expect(listed('EVENT_CHANNELS')).toEqual(Object.keys(ipcEvents).sort());
  });

  it('has no channel that accepts a path, a command or arbitrary data', () => {
    for (const [channel, contract] of Object.entries(ipcContract)) {
      const request = contract.request.safeParse({
        filePath: 'C:/anywhere',
        command: 'whoami',
      });
      expect(request.success, channel).toBe(false);
    }
  });

  it('rejects a save request that names its own destination', () => {
    const request = ipcContract['koma:project:save'].request.safeParse({
      project: buildProject(),
      filePath: 'C:/Windows/system.koma',
    });
    expect(request.success).toBe(false);
    expect(
      ipcContract['koma:project:save'].request.safeParse({ project: buildProject() }).success,
    ).toBe(true);
  });

  it('rejects a save of a project past the shared byte limit', () => {
    const project = { ...buildProject(), note: 'x'.repeat(MAX_PROJECT_FILE_BYTES + 1) };
    for (const channel of ['koma:project:save', 'koma:project:save-as'] as const) {
      const parsed = ipcContract[channel].request.safeParse({ project });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(
          parsed.error.issues.some((issue) => issue.message === PROJECT_TOO_LARGE_MESSAGE),
        ).toBe(true);
      }
    }
  }, 30_000);

  it('rejects malformed execution requests', () => {
    const valid = {
      executionId: 'execution-12345678',
      providerId: 'mock',
      project: buildProject(),
      input: { userRequest: 'Hello', objective: null, audience: null, requestedKomaCount: 3 },
    };
    const { request } = ipcContract['koma:providers:execute'];
    expect(request.safeParse(valid).success).toBe(true);
    expect(request.safeParse({ ...valid, providerId: '../claude' }).success).toBe(false);
    expect(request.safeParse({ ...valid, executionId: 'a b' }).success).toBe(false);
    expect(
      request.safeParse({ ...valid, input: { ...valid.input, userRequest: '  ' } }).success,
    ).toBe(false);
    expect(
      request.safeParse({ ...valid, input: { ...valid.input, requestedKomaCount: -1 } }).success,
    ).toBe(false);
  });
});

describe('image assets', () => {
  it('recognises images by their content', () => {
    expect(detectImageType(PNG)).toBe('image/png');
    expect(detectImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectImageType(new TextEncoder().encode('GIF89a'))).toBe('image/gif');
    expect(detectImageType(new TextEncoder().encode('RIFF0000WEBPVP8 '))).toBe('image/webp');
    expect(detectImageType(new TextEncoder().encode('<svg onload="alert(1)">'))).toBeNull();
    expect(detectImageType(new TextEncoder().encode('MZ executable'))).toBeNull();
  });

  it('creates an asset without any trace of the original location', () => {
    const asset = createImageAsset({
      bytes: PNG,
      fileName: 'logo.png',
      idGenerator: createSeededIdGenerator('logo'),
    });
    expect(asset.ok).toBe(true);
    if (asset.ok) {
      expect(assetReferenceSchema.safeParse(asset.value).success).toBe(true);
      expect(asset.value).toMatchObject({
        name: 'logo.png',
        mediaType: 'image/png',
        metadata: { byteLength: PNG.byteLength },
      });
      expect(asset.value.projectPath).toBe(`assets/${asset.value.id}.png`);
      expect(asset.value.embeddedData?.data).toBe(Buffer.from(PNG).toString('base64'));
    }
  });

  it('trusts the content, not the file name', () => {
    const asset = createImageAsset({
      bytes: new TextEncoder().encode('#!/bin/sh\nrm -rf /'),
      fileName: 'logo.png',
      idGenerator: createSeededIdGenerator('logo'),
    });
    expect(asset).toEqual({
      ok: false,
      error: 'The selected file is not a PNG, JPEG, WebP or GIF image.',
    });
  });

  it('rejects empty and oversized files', () => {
    const idGenerator = createSeededIdGenerator('logo');
    expect(createImageAsset({ bytes: new Uint8Array(), fileName: 'a.png', idGenerator }).ok).toBe(
      false,
    );
    const large = new Uint8Array(MAX_EMBEDDED_ASSET_BYTES + 1);
    large.set(PNG);
    const result = createImageAsset({ bytes: large, fileName: 'a.png', idGenerator });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('larger than 2 MB');
    }
  });

  it('cleans file names for display', () => {
    expect(toDisplayName('C:\\Users\\me\\logo<1>.png')).toBe('CUsersmelogo1.png');
    expect(toDisplayName('\u0000\u0007')).toBe('image');
  });
});

describe('generatePresentation', () => {
  const input = {
    userRequest: 'Introduce Koma Motion',
    objective: null,
    audience: null,
    requestedKomaCount: 3,
  };
  const now = (): Date => new Date('2026-09-29T12:00:00.000Z');

  function run(
    provider: MockAgentProvider | ScriptedProvider,
    events: ExecutionStatusEvent[] = [],
  ): ReturnType<typeof generatePresentation> {
    return generatePresentation({
      runner: new GenerationRunner({ registry: new ProviderRegistry([provider]), now }),
      executionId: 'execution-1',
      providerId: provider.id,
      project: buildProject(),
      input,
      idGenerator: createSeededIdGenerator('history'),
      now,
      onStatus: (event) => events.push(event),
    });
  }

  it('returns a complete presentation and a history entry', async () => {
    const events: ExecutionStatusEvent[] = [];
    const outcome = await run(new MockAgentProvider({ delayMs: 0 }), events);

    expect(outcome.status).toBe('succeeded');
    if (outcome.status === 'succeeded') {
      expect(presentationSchema.safeParse(outcome.presentation).success).toBe(true);
      expect(outcome.presentation.komas).toHaveLength(3);
      expect(outcome.presentation.transitions).toHaveLength(2);
      expect(outcome.historyEntry).toMatchObject({
        createdAt: '2026-09-29T12:00:00.000Z',
        providerId: 'mock',
        userRequest: 'Introduce Koma Motion',
        status: 'succeeded',
        summary: 'Created 3 Komas: One connected system, The motion engine, Motion you can edit',
      });
    }
    expect(events.map((event) => event.phase)).toContain('converting');
  });

  it('is deterministic for the same project and request', async () => {
    const first = await run(new MockAgentProvider({ delayMs: 0 }));
    const second = await run(new MockAgentProvider({ delayMs: 0 }));
    expect(first.status === 'succeeded' && second.status === 'succeeded').toBe(true);
    if (first.status === 'succeeded' && second.status === 'succeeded') {
      expect(second.presentation).toEqual(first.presentation);
    }
  });

  it('reports a failure without a presentation', async () => {
    const outcome = await run(new ScriptedProvider(['not json', 'still not json']));
    expect(outcome.status).toBe('failed');
    expect(outcome).not.toHaveProperty('presentation');
    if (outcome.status !== 'succeeded') {
      expect(outcome.error.code).toBe('noStructuredOutput');
      expect(outcome.historyEntry.status).toBe('failed');
      expect(outcome.diagnostics.attempts).toHaveLength(2);
    }
  });

  it('passes the model chosen for the provider in the project, or none for the default', async () => {
    const answer = JSON.stringify(buildResponse());
    for (const model of ['claude-opus-5-5', null]) {
      const provider = new ScriptedProvider([answer]);
      const base = buildProject();
      await generatePresentation({
        runner: new GenerationRunner({ registry: new ProviderRegistry([provider]), now }),
        executionId: 'execution-1',
        providerId: provider.id,
        project: {
          ...base,
          agentConfiguration: {
            ...base.agentConfiguration,
            providers: {
              [provider.id]: {
                model,
                reasoningByModel: {
                  'claude-opus-5-5': 'future-effort',
                  'other-model': 'wrong-effort',
                },
              },
              other: { model: 'not-this-one' },
            },
          },
        },
        input,
        idGenerator: createSeededIdGenerator('history'),
        now,
        onStatus: () => undefined,
      });
      expect(provider.contexts[0]?.model).toBe(model);
      expect(provider.contexts[0]?.reasoning).toBe(model === null ? null : 'future-effort');
    }
  });

  it('notes when a response had to be corrected', async () => {
    const response = await new MockAgentProvider({ delayMs: 0 }).generatePresentation(
      // The scripted provider replays the answer of the mock provider.
      (await import('@koma-motion/agent-runtime')).buildGenerationRequest(buildProject(), input),
      {
        executionId: 'seed',
        attempt: 1,
        prompt: {
          templateId: 'x',
          templateVersion: 1,
          system: '',
          user: '',
          responseJsonSchema: {},
        },
        model: null,
        signal: new AbortController().signal,
        reportProgress: () => undefined,
      },
    );
    if (!response.ok) {
      throw new Error('Expected an answer');
    }
    const outcome = await run(new ScriptedProvider(['{}', response.output.rawText]));
    expect(outcome.status).toBe('succeeded');
    if (outcome.status === 'succeeded') {
      expect(outcome.repaired).toBe(true);
      expect(outcome.warnings.at(-1)).toContain('corrected once');
    }
  });
});
