import { describe, expect, it } from 'vitest';
import { parseModelFavorites } from './modelFavoritesStore';

describe('model favorites', () => {
  it('retains an intentionally empty list and deduplicates valid choices', () => {
    expect(parseModelFavorites('[]')).toEqual([]);
    expect(
      parseModelFavorites(
        JSON.stringify([
          { providerId: 'codex', model: '' },
          { providerId: 'codex', model: '' },
          { providerId: 'claude-code', model: 'claude-opus-5-5[1m]' },
          { providerId: 'codex', model: 'two words' },
          null,
        ]),
      ),
    ).toEqual([
      { providerId: 'codex', model: '' },
      { providerId: 'claude-code', model: 'claude-opus-5-5[1m]' },
    ]);
  });
  it('recovers from unreadable or excessive stored preferences', () => {
    const defaults = parseModelFavorites(null);
    expect(parseModelFavorites('{bad')).toEqual(defaults);
    expect(parseModelFavorites('{}')).toEqual(defaults);
    expect(parseModelFavorites(JSON.stringify(Array.from({ length: 101 }, () => null)))).toEqual(
      defaults,
    );
  });
});
