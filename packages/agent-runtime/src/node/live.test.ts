/**
 * Tests against the agent CLIs installed on this computer. They are skipped
 * unless they are requested, because they need the CLIs and generation uses
 * the account of the person running them.
 *
 *   KOMA_LIVE_DETECTION=1            detects the installed CLIs (no generation)
 *   KOMA_LIVE_GENERATION=claude-code generates three Komas with Claude Code
 *   KOMA_LIVE_GENERATION=grok        generates three Komas with Grok
 *   KOMA_LIVE_GENERATION=codex       generates three Komas with Codex CLI
 *   KOMA_LIVE_MODEL=<model>          model for the generation test
 *   KOMA_LIVE_OUTPUT_DIR=<folder>    also writes events and the result as JSON
 *
 * Add `--reporter=verbose` to see the logged phases and diagnostics.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSeededIdGenerator } from '@koma-motion/core';
import { describe, expect, it } from 'vitest';
import { convertResponseToPresentation } from '../conversion/toPresentation';
import { ProviderRegistry } from '../providers/registry';
import type { AgentProvider, ExecutionStatusEvent } from '../providers/types';
import { GenerationRunner } from '../runtime/GenerationRunner';
import { buildRequest } from '../testing/fixtures';
import { ClaudeCodeProvider } from './ClaudeCodeProvider';
import { CodexCliProvider } from './CodexCliProvider';
import { GrokCliProvider } from './GrokCliProvider';

const detectionRequested = process.env['KOMA_LIVE_DETECTION'] === '1';
const generationProvider = process.env['KOMA_LIVE_GENERATION'] ?? '';
const model = process.env['KOMA_LIVE_MODEL'] ?? null;
const outputDirectory = process.env['KOMA_LIVE_OUTPUT_DIR'] ?? null;

describe.runIf(detectionRequested)('live detection', () => {
  it('detects the installed CLIs', async () => {
    const registry = new ProviderRegistry([
      new ClaudeCodeProvider(),
      new CodexCliProvider(),
      new GrokCliProvider(),
    ]);
    const detected = await registry.detectAll();
    for (const { metadata, detection } of detected) {
      console.info(`${metadata.displayName}: ${detection.availability} - ${detection.message}`);
      expect(detection.availability).toBe('available');
      expect(detection.version).toMatch(/^\d+\.\d+\.\d+/);
    }
  }, 60_000);
});

const LIVE_REQUEST =
  'Create a three-frame presentation introducing Koma Motion. Start with the complete system, focus on the motion engine, then reveal how the result stays editable. Keep it simple: at most 8 elements per frame.';

/** Runs one three-Koma generation through the runtime and checks the converted result. */
async function generateLive(provider: AgentProvider, executionId: string): Promise<void> {
  const runner = new GenerationRunner({ registry: new ProviderRegistry([provider]) });
  const events: ExecutionStatusEvent[] = [];
  const request = buildRequest({ userRequest: LIVE_REQUEST, requestedKomaCount: 3 });

  const result = await runner.execute({
    executionId,
    providerId: provider.id,
    request,
    model,
    timeoutMs: 600_000,
    onStatus: (event) => events.push(event),
  });

  if (outputDirectory !== null) {
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      join(outputDirectory, `${executionId}.json`),
      JSON.stringify({ model, events, result }, null, 2),
      'utf8',
    );
  }
  console.info(events.map((event) => `${event.phase}: ${event.message}`).join('\n'));
  console.info(JSON.stringify(result.diagnostics, null, 2));
  if (result.status !== 'succeeded') {
    console.info(JSON.stringify(result.error, null, 2));
  }
  expect(result.status).toBe('succeeded');
  if (result.status !== 'succeeded') {
    return;
  }

  expect(result.response.komas).toHaveLength(3);
  const converted = convertResponseToPresentation(result.response, {
    request,
    idGenerator: createSeededIdGenerator(executionId),
  });
  expect(converted.ok).toBe(true);
  if (converted.ok) {
    const { presentation } = converted.value;
    const retained = presentation.transitions.flatMap((transition) =>
      transition.elementTransitions.filter((item) => item.from !== null && item.to !== null),
    );
    console.info(
      presentation.komas
        .map((koma) => `${koma.title}: ${String(koma.elements.length)} elements`)
        .join('\n'),
    );
    console.info(
      `repaired: ${String(result.repaired)}, retained operations: ${String(retained.length)}`,
    );
    expect(presentation.transitions).toHaveLength(2);
    expect(retained.length).toBeGreaterThan(0);
  }
}

describe.runIf(generationProvider === 'claude-code')('live generation with Claude Code', () => {
  it('creates a valid presentation with three Komas', async () => {
    await generateLive(new ClaudeCodeProvider(), 'live');
  }, 660_000);
});

describe.runIf(generationProvider === 'grok')('live generation with Grok', () => {
  it('creates a valid presentation with three Komas', async () => {
    await generateLive(new GrokCliProvider(), 'live-grok');
  }, 660_000);
});

describe.runIf(generationProvider === 'codex')('live generation with Codex CLI', () => {
  it('creates a valid presentation with three Komas', async () => {
    await generateLive(new CodexCliProvider(), 'live-codex');
  }, 660_000);
});
