import type { Koma } from '@koma-motion/core';

export interface KomaSearchResult {
  readonly koma: Koma;
  /** Position in the full deck, not in the filtered results. */
  readonly number: number;
}

/** Searches metadata only. Filtering never changes the deck or its transition adjacency. */
export function searchKomas(komas: readonly Koma[], query: string): KomaSearchResult[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const results = komas.flatMap((koma, index) => {
    const number = index + 1;
    const metadata = `${String(number)} ${koma.title} ${koma.purpose}`.toLocaleLowerCase();
    return words.every((word) => metadata.includes(word)) ? [{ koma, number }] : [];
  });
  // A typed deck position wins over incidental numbers in earlier titles or purposes.
  const position = /^\d+$/.test(query.trim()) ? Number(query.trim()) : null;
  const exact = results.findIndex((result) => result.number === position);
  if (exact > 0) {
    const [match] = results.splice(exact, 1);
    if (match !== undefined) results.unshift(match);
  }
  return results;
}

/** Direct moves reject invalid input rather than relying on the relative command's clamping. */
export function getKomaMoveOffset(
  komas: readonly Koma[],
  komaId: string,
  rawPosition: string,
): number | null {
  const value = rawPosition.trim();
  if (!/^\d+$/.test(value)) return null;
  const position = Number(value);
  const current = komas.findIndex((koma) => koma.id === komaId);
  if (!Number.isSafeInteger(position) || position < 1 || position > komas.length || current < 0)
    return null;
  return position - 1 - current;
}
