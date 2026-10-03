import { randomUUID } from 'node:crypto';
import { open, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { createCliEnvironment, type CliEnvironment } from './cliEnvironment';

const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const eventSchema = z.object({
  type: z.string(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  status: z.string().nullish(),
  rawOutput: z.unknown().optional(),
  sessionId: z.string().optional(),
  stopReason: z.string().optional(),
});
const mediaSchema = z.object({ type: z.literal('ImageGen'), path: z.string().min(1) });

/** Grok's documented sessions/<URL-encoded cwd>/<UUID>/images output directory. */
export function grokImageDirectory(home: string, cwd: string, sessionId: string): string {
  const encoded = encodeURIComponent(cwd).replace(
    /[!'()*]/g,
    (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  // Longer paths use a CLI-specific hash. Fail closed instead of guessing a directory.
  if (Buffer.byteLength(encoded) > 255) throw new Error('The temporary image path is too long.');
  return join(home, 'sessions', encoded, sessionId, 'images');
}

/** Only tool results from this run are candidates; assistant prose is never a file path. */
export function parseGrokImageOutput(output: string, sessionId: string): string {
  const calls = new Set<string>();
  let imagePath: string | undefined;
  let completed = false;
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    if (completed) throw new Error('Grok returned data after completing image generation.');
    const event = eventSchema.parse(JSON.parse(line));
    if (event.type === 'error')
      throw new Error('Grok image generation failed. Check your CLI sign-in and image access.');
    if (event.type === 'tool_call' && event.toolName === 'image_gen' && event.toolCallId) {
      calls.add(event.toolCallId);
    }
    if (event.type === 'tool_call_update' && event.toolCallId && calls.has(event.toolCallId)) {
      if (event.status === 'failed') throw new Error('Grok could not generate the image.');
      if (event.status === 'completed') {
        const media = mediaSchema.safeParse(event.rawOutput);
        if (!media.success || imagePath)
          throw new Error('Grok did not return one generated image.');
        imagePath = media.data.path;
      }
    }
    if (event.type === 'end') {
      completed = event.sessionId === sessionId && event.stopReason === 'end_turn';
      if (!completed) throw new Error('Grok image generation did not complete.');
    }
  }
  if (!completed || !imagePath)
    throw new Error('Grok returned no image. Check your CLI sign-in and image access.');
  return imagePath;
}

/** Import only a numbered image inside the app-created CLI session, including realpath checks. */
export async function readGrokImage(path: string, directory: string): Promise<Uint8Array> {
  if (dirname(resolve(path)) !== resolve(directory) || !/^[1-9]\d*\.jpg$/.test(basename(path)))
    throw new Error('Grok returned an image outside this generation session.');
  const canonical = await realpath(path);
  if (canonical !== resolve(path)) throw new Error('Grok returned a redirected image path.');
  const file = await open(canonical, 'r');
  try {
    const stats = await file.stat();
    if (!stats.isFile() || stats.size < 1 || stats.size > MAX_IMAGE_BYTES)
      throw new Error('The generated image exceeds the image import limit.');
    const bytes = Buffer.alloc(stats.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await file.read(bytes, size, bytes.length - size, size);
      if (read.bytesRead === 0) break;
      size += read.bytesRead;
    }
    if (size !== stats.size) throw new Error('The generated image changed while importing.');
    return bytes.subarray(0, size);
  } finally {
    await file.close();
  }
}

/**
 * Grok 1.0.44: headless streaming-json + image_gen, using the existing CLI sign-in.
 * Protocol and media paths are documented in xai-org/grok-build (2026-10-01).
 * The CLI owns credentials and model selection; Koma never calls an image API.
 */
export async function generateGrokImage(
  prompt: string,
  signal: AbortSignal,
  environment: CliEnvironment = createCliEnvironment(),
): Promise<Uint8Array> {
  signal.throwIfAborted();
  const executable = await environment.resolveExecutable('grok');
  if (!executable) throw new Error('Install Grok CLI and sign in to generate images.');
  const workingDirectory = await environment.createWorkingDirectory();
  try {
    const cwd = await realpath(workingDirectory);
    const sessionId = randomUUID();
    const env = Object.fromEntries(
      Object.entries(environment.childEnvironment('grok')).filter(
        ([name]) =>
          !['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY'].includes(name.toUpperCase()),
      ),
    );
    const grokHome = await realpath(env['GROK_HOME'] ?? join(homedir(), '.grok'));
    const directory = grokImageDirectory(grokHome, cwd, sessionId);
    const promptFile = join(cwd, 'prompt.txt');
    await writeFile(promptFile, prompt, 'utf8');
    const outcome = await environment.runProcess({
      executable,
      arguments: [
        '--prompt-file',
        promptFile,
        '--output-format',
        'streaming-json',
        '--verbatim',
        '--session-id',
        sessionId,
        '--cwd',
        cwd,
        '--tools',
        'image_gen',
        '--disable-web-search',
        '--no-subagents',
        '--no-plan',
        '--no-memory',
        '--max-turns',
        '2',
        '--permission-mode',
        'dontAsk',
        '--allow',
        '*',
        ...['MCPTool', 'Bash', 'Read', 'Edit', 'Write', 'Grep', 'WebFetch', 'WebSearch'].flatMap(
          (tool) => ['--deny', tool],
        ),
        '--sandbox',
        'strict',
        '--system-prompt-override',
        'Generate exactly one image using image_gen with the supplied visual description. Choose its aspect_ratio from the description. Do not call any other tool. Do not retry a failed or blocked image request. After the image_gen result, finish immediately. Do not read or copy the image.',
      ],
      input: '',
      workingDirectory: cwd,
      signal,
      maxOutputBytes: 4 * 1024 * 1024,
      env: {
        ...env,
        GROK_HOME: grokHome,
        GROK_DISABLE_API_KEY_AUTH: '1',
        GROK_MANAGED_MCPS_ENABLED: '0',
        GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED: '0',
        GROK_CONFIG: JSON.stringify({ features: { image_gen: true } }),
      },
    });
    if (outcome.aborted) throw new Error('Image generation was stopped.');
    if (outcome.exitCode !== 0 || outcome.outputLimitExceeded || outcome.startError)
      throw new Error('Grok image generation failed. Check your CLI sign-in and image access.');
    signal.throwIfAborted();
    return await readGrokImage(parseGrokImageOutput(outcome.standardOutput, sessionId), directory);
  } finally {
    await environment.removeWorkingDirectory(workingDirectory).catch(() => undefined);
  }
}
