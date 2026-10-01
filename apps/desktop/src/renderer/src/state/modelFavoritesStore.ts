import { modelNameSchema, providerIdSchema } from '@koma-motion/core';
import { create } from 'zustand';

export interface ModelFavorite {
  readonly providerId: string;
  readonly model: string;
}
export const MODEL_FAVORITES_KEY = 'koma-motion:model-favorites';
const DEFAULT_FAVORITES: readonly ModelFavorite[] = [];

export function parseModelFavorites(text: string | null): readonly ModelFavorite[] {
  if (text === null) return DEFAULT_FAVORITES;
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value) || value.length > 100) return DEFAULT_FAVORITES;
    const favorites: ModelFavorite[] = [];
    for (const item of value as unknown[]) {
      if (
        typeof item !== 'object' ||
        item === null ||
        !('providerId' in item) ||
        !('model' in item)
      )
        continue;
      const provider = providerIdSchema.safeParse(item.providerId);
      const model = item.model === '' ? '' : modelNameSchema.safeParse(item.model).data;
      if (!provider.success || model === undefined) continue;
      if (
        !favorites.some(
          (favorite) => favorite.providerId === provider.data && favorite.model === model,
        )
      )
        favorites.push({ providerId: provider.data, model });
    }
    return favorites;
  } catch {
    return DEFAULT_FAVORITES;
  }
}

function load(): readonly ModelFavorite[] {
  try {
    return parseModelFavorites(
      typeof window === 'undefined' ? null : window.localStorage.getItem(MODEL_FAVORITES_KEY),
    );
  } catch {
    return DEFAULT_FAVORITES;
  }
}

export const useModelFavoritesStore = create<{
  readonly favorites: readonly ModelFavorite[];
  readonly toggle: (favorite: ModelFavorite) => void;
}>((set) => ({
  favorites: load(),
  toggle(favorite) {
    set((state) => {
      const exists = state.favorites.some(
        (item) => item.providerId === favorite.providerId && item.model === favorite.model,
      );
      const favorites = exists
        ? state.favorites.filter(
            (item) => item.providerId !== favorite.providerId || item.model !== favorite.model,
          )
        : [...state.favorites, favorite].slice(-100);
      try {
        window.localStorage.setItem(MODEL_FAVORITES_KEY, JSON.stringify(favorites));
      } catch {
        /* Preferences still work for this session. */
      }
      return { favorites };
    });
  },
}));
