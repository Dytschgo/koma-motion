import type { ProviderMetadata } from '@koma-motion/agent-runtime';
import type { AgentConfiguration } from '@koma-motion/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KOMA_COUNT,
  DEFAULT_MODEL_VALUE,
  getModelChoices,
  parseKomaCount,
  withProviderModel,
} from './composerChoices';

function provider(overrides: Partial<ProviderMetadata> = {}): ProviderMetadata {
  return {
    id: 'claude-code',
    displayName: 'Claude Code',
    description: 'Runs the Claude Code CLI.',
    kind: 'cli',
    usesExternalService: true,
    supportsModelSelection: true,
    defaultModel: null,
    ...overrides,
  };
}

function configuration(providers: AgentConfiguration['providers'] = {}): AgentConfiguration {
  return { selectedProviderId: 'claude-code', timeoutSeconds: null, providers };
}

describe('model choices', () => {
  it('offers only Default when no model is configured', () => {
    expect(getModelChoices(provider(), configuration())).toEqual({
      options: [{ value: DEFAULT_MODEL_VALUE, label: 'Default' }],
      value: DEFAULT_MODEL_VALUE,
      selectable: true,
    });
  });

  it('offers the configured model id of the provider and selects it', () => {
    const choices = getModelChoices(
      provider(),
      configuration({ 'claude-code': { model: 'opus' }, codex: { model: 'gpt-6' } }),
    );
    expect(choices.options.map((option) => option.value)).toEqual([DEFAULT_MODEL_VALUE, 'opus']);
    expect(choices.value).toBe('opus');
  });

  it('follows the provider: another provider shows its own model or Default', () => {
    const config = configuration({ 'claude-code': { model: 'opus' } });
    const codex = getModelChoices(provider({ id: 'codex', displayName: 'Codex' }), config);
    expect(codex.value).toBe(DEFAULT_MODEL_VALUE);
    expect(codex.options).toEqual([{ value: DEFAULT_MODEL_VALUE, label: 'Default' }]);
  });

  it('names a known provider default and does not list it twice', () => {
    const choices = getModelChoices(
      provider({ defaultModel: 'sonnet' }),
      configuration({ 'claude-code': { model: 'sonnet' } }),
    );
    expect(choices.options).toEqual([{ value: DEFAULT_MODEL_VALUE, label: 'Default (sonnet)' }]);
    expect(choices.value).toBe(DEFAULT_MODEL_VALUE);
  });

  it('keeps a model chosen earlier reachable after Default', () => {
    const choices = getModelChoices(provider(), configuration(), 'opus');
    expect(choices.options.map((option) => option.value)).toEqual([DEFAULT_MODEL_VALUE, 'opus']);
    expect(choices.value).toBe(DEFAULT_MODEL_VALUE);
  });

  it('offers no choice for a provider without model selection, or before detection', () => {
    const mock = getModelChoices(
      provider({ id: 'mock', supportsModelSelection: false }),
      configuration({ mock: { model: 'ignored' } }),
    );
    expect(mock).toEqual({
      options: [{ value: DEFAULT_MODEL_VALUE, label: 'Default' }],
      value: DEFAULT_MODEL_VALUE,
      selectable: false,
    });
    expect(getModelChoices(undefined, configuration()).selectable).toBe(false);
  });

  it('stores the model per provider, Default as null', () => {
    const config = configuration({ codex: { model: 'gpt-6' } });
    expect(withProviderModel(config, 'claude-code', 'opus').providers).toEqual({
      codex: { model: 'gpt-6' },
      'claude-code': { model: 'opus' },
    });
    expect(
      withProviderModel(config, 'codex', DEFAULT_MODEL_VALUE).providers['codex']?.model,
    ).toBeNull();
    expect(withProviderModel(config, 'codex', 'x').selectedProviderId).toBe('claude-code');
  });
});

describe('Koma count', () => {
  it('starts at five', () => {
    expect(DEFAULT_KOMA_COUNT).toBe(5);
    expect(parseKomaCount(false, String(DEFAULT_KOMA_COUNT))).toBe(5);
  });

  it('leaves the number to the agent with Auto', () => {
    expect(parseKomaCount(true, '5')).toBeNull();
    expect(parseKomaCount(true, 'nonsense')).toBeNull();
  });

  it('accepts positive whole numbers only', () => {
    expect(parseKomaCount(false, ' 30 ')).toBe(30);
    for (const text of ['', '0', '-2', '2.5', '1e3', 'five', String(2 ** 60)]) {
      expect(parseKomaCount(false, text)).toBeUndefined();
    }
  });
});
