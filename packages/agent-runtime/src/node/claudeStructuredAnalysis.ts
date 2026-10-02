import { z } from 'zod';
import type { CliEnvironment } from './cliEnvironment';

/** Arguments of an isolated analysis run: no tools, no customizations, explicit Opus. */
export function structuredAnalysisArguments(system: string, schema: z.ZodType): string[] {
  return [
    '--print',
    '--verbose',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--tools',
    '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--permission-prompts',
    'none',
    '--no-session-persistence',
    '--safe-mode',
    '--restricted',
    '--no-chrome',
    '--model',
    'opus',
    '--system-prompt',
    system,
    '--json-schema',
    JSON.stringify(z.toJSONSchema(schema, { io: 'input', target: 'draft-7' })),
  ];
}

const eventSchema = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  is_error: z.boolean().optional(),
  structured_output: z.unknown().optional(),
});

export interface StructuredAnalysisRun {
  /** One stream-json user message with inline images. No image paths or Read tool. */
  readonly input: string;
  readonly arguments: string[];
  readonly signal: AbortSignal;
  /** Sentences for the user. CLI output never reaches them. */
  readonly messages: {
    readonly tooLarge: string;
    readonly notInstalled: string;
    readonly failed: string;
    readonly malformed: string;
    readonly incomplete: string;
  };
}

/** Runs Claude Code once and returns its structured output, still unvalidated. */
export async function runClaudeStructuredAnalysis(
  environment: CliEnvironment,
  run: StructuredAnalysisRun,
): Promise<unknown> {
  run.signal.throwIfAborted();
  if (Buffer.byteLength(run.input) > 24 * 1024 * 1024) throw new Error(run.messages.tooLarge);
  const executable = await environment.resolveExecutable('claude');
  if (executable === null) throw new Error(run.messages.notInstalled);
  const workingDirectory = await environment.createWorkingDirectory();
  try {
    const outcome = await environment.runProcess({
      executable,
      arguments: run.arguments,
      input: run.input,
      workingDirectory,
      signal: run.signal,
      maxOutputBytes: 2 * 1024 * 1024,
      env: {
        ...environment.childEnvironment(),
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
      },
    });
    run.signal.throwIfAborted();
    // Never expose arbitrary CLI stderr: it may contain reference data or credentials.
    if (
      outcome.aborted ||
      outcome.outputLimitExceeded ||
      outcome.startError !== null ||
      outcome.exitCode !== 0
    ) {
      throw new Error(run.messages.failed);
    }
    let results;
    try {
      results = outcome.standardOutput
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => eventSchema.parse(JSON.parse(line)))
        .filter((event) => event.type === 'result');
    } catch {
      throw new Error(run.messages.malformed);
    }
    const result = results[0];
    if (
      results.length !== 1 ||
      result?.subtype !== 'success' ||
      result.is_error === true ||
      result.structured_output === undefined
    ) {
      throw new Error(run.messages.incomplete);
    }
    return result.structured_output;
  } finally {
    await environment.removeWorkingDirectory(workingDirectory);
  }
}
