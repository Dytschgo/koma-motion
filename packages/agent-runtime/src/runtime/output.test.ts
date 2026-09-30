import { describe, expect, it } from 'vitest';
import type { PresentationGenerationRequest } from '../contract/request';
import { MockAgentProvider } from '../providers/mock/MockAgentProvider';
import { ProviderRegistry } from '../providers/registry';
import {
  MAX_OUTPUT_EVENT_LENGTH,
  type AgentExecutionContext,
  type ExecutionOutputEvent,
  type ProviderExecutionResult,
} from '../providers/types';
import { buildRequest } from '../testing/fixtures';
import { GenerationRunner } from './GenerationRunner';

/** The mock provider, but it writes a long text before it answers. */
class TalkativeProvider extends MockAgentProvider {
  override generatePresentation(
    request: PresentationGenerationRequest,
    context: AgentExecutionContext,
  ): Promise<ProviderExecutionResult> {
    context.reportOutput?.('x'.repeat(MAX_OUTPUT_EVENT_LENGTH * 2 + 5));
    return super.generatePresentation(request, context);
  }
}

describe('streamed output', () => {
  it('forwards text with the execution and attempt, split into bounded events', async () => {
    const provider = new TalkativeProvider({ delayMs: 0 });
    const runner = new GenerationRunner({ registry: new ProviderRegistry([provider]) });
    const events: ExecutionOutputEvent[] = [];
    const result = await runner.execute({
      executionId: 'execution-1',
      providerId: provider.id,
      request: buildRequest(),
      onOutput: (event) => events.push(event),
    });
    expect(result.status).toBe('succeeded');
    expect(events.every((event) => event.executionId === 'execution-1')).toBe(true);
    expect(events.every((event) => event.attempt === 1)).toBe(true);
    expect(events.every((event) => event.text.length <= MAX_OUTPUT_EVENT_LENGTH)).toBe(true);
    const text = events.map((event) => event.text).join('');
    expect(text.startsWith('x'.repeat(MAX_OUTPUT_EVENT_LENGTH * 2 + 5))).toBe(true);
    expect(text).toContain('Demo narration from the mock provider.');
  });

  it('sends nothing after the run was cancelled', async () => {
    const provider = new MockAgentProvider({ delayMs: 600 });
    const runner = new GenerationRunner({ registry: new ProviderRegistry([provider]) });
    const events: ExecutionOutputEvent[] = [];
    let cancelledAt = -1;
    const run = runner.execute({
      executionId: 'execution-2',
      providerId: provider.id,
      request: buildRequest(),
      onOutput: (event) => {
        events.push(event);
        if (cancelledAt === -1) {
          runner.cancel('execution-2');
          cancelledAt = events.length;
        }
      },
    });
    const result = await run;
    expect(result.status).toBe('cancelled');
    expect(events).toHaveLength(cancelledAt);
  });
});
