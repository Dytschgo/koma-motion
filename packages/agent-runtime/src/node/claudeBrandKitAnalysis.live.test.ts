import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { analyzeBrandKitWithClaude } from './claudeBrandKitAnalysis';
import { createCliEnvironment } from './cliEnvironment';
import { redactDiagnostics } from './redact';

it.skipIf(process.env['KOMA_LIVE_DECK_PROBE'] !== '1')(
  'verifies the signed-in Opus image and structured response path',
  async () => {
    const environment = createCliEnvironment();
    const run = environment.runProcess.bind(environment);
    environment.runProcess = async (specification) => {
      const result = await run(specification);
      // Synthetic fixture only. Never log stdin, auth configuration or full streams.
      console.log(
        JSON.stringify({
          exitCode: result.exitCode,
          aborted: result.aborted,
          startError: result.startError,
          outputLimitExceeded: result.outputLimitExceeded,
          stderr: redactDiagnostics(result.standardError, 1000),
          outputBytes: result.standardOutput.length,
        }),
      );
      for (const line of result.standardOutput.split('\n')) {
        if (!line.trim()) continue;
        const event: unknown = JSON.parse(line);
        if (
          typeof event === 'object' &&
          event !== null &&
          'type' in event &&
          event.type === 'system' &&
          'model' in event
        )
          console.log(JSON.stringify({ model: event.model }));
      }
      return result;
    };
    const png = await readFile(join(import.meta.dirname, '../testing/brand-vision-probe.png'));
    const proposal = await analyzeBrandKitWithClaude(
      environment,
      {
        slides: [
          {
            number: 1,
            text: 'Northstar Studio. Clear thinking. Confident design.',
            preview: png.toString('base64'),
          },
        ],
        totalSlides: 1,
        logoCandidates: [],
      },
      { model: 'opus', signal: AbortSignal.timeout(120000) },
    );
    expect(proposal.brandKit.name).toMatch(/Northstar/i);
    expect(proposal.evidence.length).toBeGreaterThan(0);
  },
  130000,
);
