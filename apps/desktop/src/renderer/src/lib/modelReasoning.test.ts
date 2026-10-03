import { describe, expect, it } from 'vitest';
import type { AgentConfiguration } from '@koma-motion/core';
import type { ProviderModelListing } from '@koma-motion/agent-runtime';
import {
  getReasoningSelection,
  withModelReasoning,
  withSelectedProviderModel,
} from './composerChoices';

const config: AgentConfiguration = {
  selectedProviderId: 'codex',
  timeoutSeconds: null,
  providers: { codex: { model: 'fixture-a' } },
};
const listed: ProviderModelListing = {
  status: 'listed',
  defaultModel: null,
  checkedAt: '2026-10-03T12:00:00Z',
  models: [
    {
      id: 'fixture-a',
      label: 'Fixture A',
      reasoning: {
        status: 'supported',
        choices: [{ value: 'deep-v2', label: 'Deep' }],
        defaultValue: null,
      },
    },
  ],
};
describe('project model reasoning choices', () => {
  it('retains choices independently across models and providers without applying them to defaults', () => {
    let current = withModelReasoning(config, 'codex', 'fixture-a', 'deep-v2');
    current = withSelectedProviderModel(current, 'codex', 'fixture-b');
    expect(getReasoningSelection(current, 'codex', listed).saved).toBeNull();
    current = withModelReasoning(current, 'codex', 'fixture-b', 'quick');
    current = withSelectedProviderModel(current, 'grok', 'fixture-a');
    expect(getReasoningSelection(current, 'grok', listed).saved).toBeNull();
    current = withSelectedProviderModel(current, 'codex', '');
    expect(getReasoningSelection(current, 'codex', listed).saved).toBeNull();
    current = withSelectedProviderModel(current, 'codex', 'fixture-a');
    expect(getReasoningSelection(current, 'codex', listed)).toMatchObject({
      saved: 'deep-v2',
      message: null,
    });
    current = withModelReasoning(current, 'codex', 'fixture-a', null);
    expect(current.providers['codex']?.reasoningByModel).toEqual({ 'fixture-b': 'quick' });
    expect(config.providers['codex']?.reasoningByModel).toBeUndefined();
  });
  it('explains loading, failed, unsupported, missing-model and missing-effort states', () => {
    const saved = withModelReasoning(config, 'codex', 'fixture-a', 'obsolete');
    for (const listing of [
      undefined,
      'loading',
      { status: 'failed', message: 'offline' },
      { status: 'unsupported' },
      listed,
    ] as const) {
      expect(getReasoningSelection(saved, 'codex', listing).message).not.toBeNull();
    }
    expect(getReasoningSelection(config, 'codex', { status: 'unsupported' }).message).toBeNull();
    expect(getReasoningSelection(saved, 'codex', listed).message).toContain('no longer reported');
    const missing = { ...listed, models: [] };
    expect(getReasoningSelection(saved, 'codex', missing).capability).toBeUndefined();
  });
});
