import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { decodeCodexImage, generateCodexImage } from './codexImages';
import { buildCliChildEnvironment, type CliEnvironment } from './cliEnvironment';

const peer = `
import { createInterface } from 'node:readline';
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line), mode = process.env.IMAGE_TEST_MODE;
  if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.XAI_API_KEY || process.env.GROK_HOME || process.env.ANTHROPIC_CUSTOM_HEADERS) throw new Error('Unrelated auth leaked to image child');
  if (process.env.CODEX_HOME !== 'synthetic-codex-home') throw new Error('Lost Codex home');
  if (m.method === 'initialize') send({ id: m.id, result: {} });
  if (m.method === 'account/read') send({ id: m.id, result: { account: { type: mode === 'api' ? 'apiKey' : 'chatgpt' } } });
  if (m.method === 'thread/start') {
    if (!m.params.ephemeral || m.params.sandbox !== 'read-only' || m.params.approvalPolicy !== 'never') throw new Error('Wrong isolation');
    send({ id: m.id, result: { thread: { id: 'image-thread' } } });
  }
  if (m.method === 'turn/start') {
    send({ id: m.id, result: {} });
    if (mode === 'hang') return;
    if (mode !== 'empty') send({ method: 'item/completed', params: { threadId: mode === 'other' ? 'another-thread' : 'image-thread', item: { type: 'imageGeneration', status: 'completed', failure: null, result: mode === 'path' ? 'C:/private/image.png' : 'aW1hZ2U=' } } });
    send({ method: 'turn/completed', params: { threadId: 'image-thread', turn: { status: 'completed' } } });
  }
});
`;

async function fixture(mode: string, task: (env: CliEnvironment) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'koma-image-peer-'));
  const script = join(root, 'peer.mjs');
  let work = '';
  await writeFile(script, peer);
  const env: CliEnvironment = {
    resolveExecutable: () =>
      Promise.resolve({ command: process.execPath, prefixArguments: [script] }),
    childEnvironment: (provider) => {
      expect(provider).toBe('codex');
      return {
        ...buildCliChildEnvironment(
          {
            SystemRoot: process.env['SystemRoot'],
            OPENAI_API_KEY: 'synthetic-openai',
            CODEX_HOME: 'synthetic-codex-home',
            ANTHROPIC_API_KEY: 'synthetic-anthropic',
            ANTHROPIC_CUSTOM_HEADERS: 'synthetic-gateway',
            XAI_API_KEY: 'synthetic-xai',
            GROK_HOME: 'synthetic-grok-home',
          },
          provider,
        ),
        IMAGE_TEST_MODE: mode,
      };
    },
    claudeCodeChildEnvironment: () => ({}),
    runProcess: () => Promise.reject(new Error('Not used')),
    createWorkingDirectory: async () => {
      work = await mkdtemp(join(root, 'work-'));
      return work;
    },
    removeWorkingDirectory: async (path) => {
      await rm(path, { recursive: true, force: true });
    },
    now: () => new Date(),
  };
  try {
    await task(env);
    await expect(access(work)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('Codex CLI image adapter', () => {
  it('uses the local stdio protocol and existing sign-in without forwarding an API key', async () => {
    await fixture('image', async (env) => {
      const bytes = await generateCodexImage('A blue illustration', AbortSignal.timeout(5000), env);
      expect(Buffer.from(bytes).toString()).toBe('image');
    });
  });
  it.each(['path', 'empty', 'other', 'api'])(
    'rejects %s output without reading arbitrary paths or using an API key',
    async (mode) => {
      await fixture(mode, async (env) => {
        await expect(
          generateCodexImage('A blue illustration', AbortSignal.timeout(5000), env),
        ).rejects.toThrow();
      });
    },
  );
  it('stops a waiting CLI and cleans its directory when cancelled', async () => {
    await fixture('hang', async (env) => {
      await expect(
        generateCodexImage('A blue illustration', AbortSignal.timeout(500), env),
      ).rejects.toThrow('stopped');
    });
  });
  it.each(['', 'https://example.com/image.png', '../image.png', 'aW1hZ2U=!'])(
    'rejects non-inline output %s',
    (value) => {
      expect(() => decodeCodexImage(value)).toThrow();
    },
  );
});
