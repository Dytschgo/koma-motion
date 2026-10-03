import { access, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateGrokImage, parseGrokImageOutput, readGrokImage } from './grokImages';
import { buildCliChildEnvironment, createCliEnvironment } from './cliEnvironment';

// Synthetic peer implements the documented streaming-json events and session media layout.
const peer = `
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1];
if (process.env.XAI_API_KEY || process.env.GROK_DISABLE_API_KEY_AUTH !== '1') throw Error('API key fallback');
if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.CODEX_HOME || process.env.ANTHROPIC_CUSTOM_HEADERS) throw Error('Unrelated auth leaked to image child');
if (value('--tools') !== 'image_gen' || value('--permission-mode') !== 'dontAsk' || !args.includes('MCPTool')) throw Error('Wrong tools');
if (!(await readFile(value('--prompt-file'), 'utf8')).includes('blue illustration')) throw Error('Lost prompt');
const sessionId = value('--session-id');
const dir = join(process.env.GROK_HOME, 'sessions', encodeURIComponent(value('--cwd')).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()), sessionId, 'images');
await mkdir(dir, {recursive:true});
const path = join(dir, '1.jpg');
await writeFile(path, 'image bytes');
const send = event => process.stdout.write(JSON.stringify(event) + '\\n');
if (process.env.GROK_TEST_MODE === 'hang') await new Promise(resolve => setTimeout(resolve, 30000));
send({type:'tool_call',toolCallId:'image-1',toolName:'image_gen'});
send({type:'tool_call_update',toolCallId:'image-1',status:null,rawOutput:null});
send({type:'tool_call_update',toolCallId:'image-1',status:'completed',rawOutput:{type:'ImageGen',path:process.env.GROK_TEST_MODE === 'outside' ? join(process.env.GROK_HOME, 'secret.jpg') : path}});
send({type:'end',sessionId,stopReason:'end_turn'});
`;

describe('Grok CLI images', () => {
  it.each(['success', 'outside', 'hang'])('handles %s with a bounded CLI peer', async (mode) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'koma-grok-peer-')));
    const script = join(root, 'peer.mjs');
    const work = join(root, 'work');
    await mkdir(work);
    await mkdir(join(root, 'grok'));
    await writeFile(script, peer);
    const environment = {
      ...createCliEnvironment(),
      resolveExecutable: () =>
        Promise.resolve({ command: process.execPath, prefixArguments: [script] }),
      childEnvironment: (provider: 'codex' | 'grok') => {
        expect(provider).toBe('grok');
        return {
          ...buildCliChildEnvironment(
            {
              SystemRoot: process.env['SystemRoot'],
              GROK_HOME: join(root, 'grok'),
              XAI_API_KEY: 'synthetic-xai',
              OPENAI_API_KEY: 'synthetic-openai',
              CODEX_HOME: 'synthetic-codex-home',
              ANTHROPIC_API_KEY: 'synthetic-anthropic',
              ANTHROPIC_CUSTOM_HEADERS: 'synthetic-gateway',
            },
            provider,
          ),
          GROK_TEST_MODE: mode,
        };
      },
      createWorkingDirectory: () => Promise.resolve(work),
    };
    try {
      const result = generateGrokImage(
        'A blue illustration',
        AbortSignal.timeout(mode === 'hang' ? 500 : 5000),
        environment,
      );
      if (mode === 'success') expect(Buffer.from(await result).toString()).toBe('image bytes');
      else await expect(result).rejects.toThrow(mode === 'hang' ? 'stopped' : 'outside');
      await expect(access(work)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    [{ type: 'text', data: 'C:/private/image.jpg' }],
    [{ type: 'error', message: 'failure' }],
    [
      { type: 'tool_call', toolCallId: 'one', toolName: 'read_file' },
      {
        type: 'tool_call_update',
        toolCallId: 'one',
        status: 'completed',
        rawOutput: { type: 'ImageGen', path: '/private/1.jpg' },
      },
    ],
    [
      { type: 'tool_call', toolCallId: 'one', toolName: 'image_gen' },
      { type: 'tool_call_update', toolCallId: 'one', status: 'failed' },
    ],
    [
      { type: 'tool_call', toolCallId: 'one', toolName: 'image_gen' },
      {
        type: 'tool_call_update',
        toolCallId: 'one',
        status: 'completed',
        rawOutput: { type: 'Text', text: 'Upgrade your subscription' },
      },
    ],
  ])('rejects prose, unrelated tools and failed image results', (...events) => {
    const output = [...events, { type: 'end', sessionId: 'test', stopReason: 'end_turn' }]
      .map((event) => JSON.stringify(event))
      .join('\n');
    expect(() => parseGrokImageOutput(output, 'test')).toThrow();
  });

  it('rejects redirected and oversized images', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'koma-grok-path-')));
    try {
      const outside = join(root, 'outside');
      const images = join(root, 'images');
      await mkdir(outside);
      await writeFile(join(outside, '1.jpg'), 'private');
      await symlink(outside, images, process.platform === 'win32' ? 'junction' : 'dir');
      await expect(readGrokImage(join(images, '1.jpg'), images)).rejects.toThrow('redirected');
      await writeFile(join(outside, '2.jpg'), Buffer.alloc(16 * 1024 * 1024 + 1));
      await expect(readGrokImage(join(outside, '2.jpg'), outside)).rejects.toThrow('limit');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['wrong-session', 'cancelled', 'missing-end'])('rejects %s completion', (mode) => {
    const events: unknown[] = [
      { type: 'tool_call', toolCallId: 'one', toolName: 'image_gen' },
      {
        type: 'tool_call_update',
        toolCallId: 'one',
        status: 'completed',
        rawOutput: { type: 'ImageGen', path: '/session/images/1.jpg' },
      },
    ];
    if (mode !== 'missing-end')
      events.push({
        type: 'end',
        sessionId: mode === 'wrong-session' ? 'other' : 'test',
        stopReason: mode === 'cancelled' ? 'cancelled' : 'end_turn',
      });
    expect(() =>
      parseGrokImageOutput(events.map((event) => JSON.stringify(event)).join('\n'), 'test'),
    ).toThrow();
  });
});
