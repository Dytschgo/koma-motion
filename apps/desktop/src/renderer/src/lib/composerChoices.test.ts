import type { ProviderMetadata, ProviderModelListing } from '@koma-motion/agent-runtime';
import type { AgentConfiguration } from '@koma-motion/core';
import { describe, expect, it } from 'vitest';
import {
  CUSTOM_MODEL_VALUE,
  DEFAULT_KOMA_COUNT,
  DEFAULT_MODEL_VALUE,
  getModelChoices,
  parseCustomModel,
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
    modelCatalog: {
      source: 'curated',
      models: [
        { id: 'opus', label: 'Opus (latest)', kind: 'alias' },
        { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', kind: 'id' },
      ],
      note: 'Curated.',
    },
    acceptsCustomModel: true,
    streamsOutput: true,
    ...overrides,
  };
}

const grok = provider({
  id: 'grok',
  displayName: 'Grok',
  modelCatalog: { source: 'cli', models: [], note: 'Grok can list models.' },
});

function configuration(providers: AgentConfiguration['providers'] = {}): AgentConfiguration {
  return { selectedProviderId: 'claude-code', timeoutSeconds: null, providers };
}

const values = (choices: { options: readonly { value: string }[] }): string[] =>
  choices.options.map((option) => option.value);

describe('model choices', () => {
  it('offers Default, the catalog and a custom id, and runs the default model by default', () => {
    const choices = getModelChoices(provider(), configuration());
    expect(values(choices)).toEqual([
      DEFAULT_MODEL_VALUE,
      'opus',
      'claude-opus-5-5',
      CUSTOM_MODEL_VALUE,
    ]);
    expect(choices.options.map((option) => option.group)).toEqual([
      'default',
      'aliases',
      'ids',
      'enter',
    ]);
    expect(choices.value).toBe(DEFAULT_MODEL_VALUE);
    expect(choices.effectiveModel).toBeNull();
    expect(choices.effectiveLabel).toBe('the default model of Claude Code');
  });

  it('selects an explicit catalog model and names it as the effective model', () => {
    const choices = getModelChoices(
      provider(),
      configuration({ 'claude-code': { model: 'claude-opus-5-5' }, codex: { model: 'gpt-6' } }),
    );
    expect(choices.value).toBe('claude-opus-5-5');
    expect(choices.effectiveModel).toBe('claude-opus-5-5');
    // A catalog model is not listed a second time as entered.
    expect(values(choices).filter((value) => value === 'claude-opus-5-5')).toHaveLength(1);
  });

  it('lists an entered model id that is not in the catalog', () => {
    const choices = getModelChoices(provider(), configuration({ 'claude-code': { model: 'x-1' } }));
    expect(choices.options.find((option) => option.value === 'x-1')?.group).toBe('custom');
    expect(choices.value).toBe('x-1');
  });

  it('follows the provider: another provider shows its own model or Default', () => {
    const config = configuration({ 'claude-code': { model: 'opus' } });
    const codex = getModelChoices(
      provider({
        id: 'codex',
        displayName: 'Codex',
        modelCatalog: { source: 'none', models: [], note: 'No list.' },
      }),
      config,
    );
    expect(codex.value).toBe(DEFAULT_MODEL_VALUE);
    expect(values(codex)).toEqual([DEFAULT_MODEL_VALUE, CUSTOM_MODEL_VALUE]);
  });

  it('names a known provider default and does not list it twice', () => {
    const choices = getModelChoices(
      provider({ defaultModel: 'sonnet', modelCatalog: { source: 'none', models: [], note: '' } }),
      configuration({ 'claude-code': { model: 'sonnet' } }),
    );
    expect(choices.options[0]).toEqual({
      value: DEFAULT_MODEL_VALUE,
      label: 'Default (sonnet)',
      group: 'default',
    });
    expect(values(choices)).toEqual([DEFAULT_MODEL_VALUE, CUSTOM_MODEL_VALUE]);
    expect(choices.value).toBe(DEFAULT_MODEL_VALUE);
    expect(choices.effectiveLabel).toBe('sonnet (default)');
  });

  it('keeps a model chosen earlier reachable after Default', () => {
    const choices = getModelChoices(provider(), configuration(), { remembered: 'x-2' });
    expect(values(choices)).toContain('x-2');
    expect(choices.value).toBe(DEFAULT_MODEL_VALUE);
  });

  it('offers the models an account listed, and marks a chosen model the list does not contain', () => {
    const listing: ProviderModelListing = {
      status: 'listed',
      models: ['grok-4.7', 'grok-4.6'],
      defaultModel: 'grok-4.7',
      checkedAt: '2026-09-30T12:00:00.000Z',
    };
    const listed = getModelChoices(grok, configuration({ grok: { model: 'grok-4.6' } }), {
      listing,
    });
    expect(values(listed)).toEqual([
      DEFAULT_MODEL_VALUE,
      'grok-4.7',
      'grok-4.6',
      CUSTOM_MODEL_VALUE,
    ]);
    expect(listed.options[0]?.label).toBe('Default (grok-4.7)');
    expect(listed.availability).toBe('listed');

    const unavailable = getModelChoices(grok, configuration({ grok: { model: 'grok-9' } }), {
      listing,
    });
    expect(unavailable.availability).toBe('notListed');
    expect(unavailable.effectiveModel).toBe('grok-9');

    const failed = getModelChoices(grok, configuration({ grok: { model: 'grok-9' } }), {
      listing: { status: 'failed', message: 'Not signed in.' },
    });
    expect(failed.availability).toBe('unknown');
  });

  it('offers no choice for a provider without model selection, or before detection', () => {
    const mock = getModelChoices(
      provider({ id: 'mock', supportsModelSelection: false, acceptsCustomModel: false }),
      configuration({ mock: { model: 'ignored' } }),
    );
    expect(values(mock)).toEqual([DEFAULT_MODEL_VALUE]);
    expect(mock.selectable).toBe(false);
    expect(mock.effectiveModel).toBeNull();
    expect(getModelChoices(undefined, configuration()).selectable).toBe(false);
  });

  it('validates an entered model id', () => {
    expect(parseCustomModel('  claude-opus-5-5[1m] ')).toEqual({
      ok: true,
      model: 'claude-opus-5-5[1m]',
    });
    for (const text of ['', '   ', 'two words', '-flag', '--model', 'a;b', 'x'.repeat(81)]) {
      expect(parseCustomModel(text).ok).toBe(false);
    }
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
