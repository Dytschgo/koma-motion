import { CANVAS_MIN_WIDTH, CHAT_MIN_WIDTH } from './chatLayout';

export const KOMA_PANE_DEFAULT_WIDTH = 244;
export const KOMA_PANE_MIN_WIDTH = 180;
export const KOMA_PANE_MAX_WIDTH = 360;
export const KOMA_PANE_COLLAPSED_WIDTH = 44;
export const KOMA_PANE_PREFERENCES_KEY = 'koma-motion:koma-pane';

export interface KomaPanePreferences {
  readonly open: boolean;
  readonly width: number;
  readonly details: boolean;
}

export const DEFAULT_KOMA_PANE: KomaPanePreferences = {
  open: true,
  width: KOMA_PANE_DEFAULT_WIDTH,
  details: false,
};

export function clampKomaPaneWidth(width: number, maximum = KOMA_PANE_MAX_WIDTH): number {
  const upper = Number.isFinite(maximum)
    ? Math.max(KOMA_PANE_MIN_WIDTH, Math.min(KOMA_PANE_MAX_WIDTH, maximum))
    : KOMA_PANE_MAX_WIDTH;
  const value = Number.isFinite(width) ? width : KOMA_PANE_DEFAULT_WIDTH;
  return Math.round(Math.min(upper, Math.max(KOMA_PANE_MIN_WIDTH, value)));
}

/** Keep room for the canvas and minimum chat while either pane is adjusted. */
export function getKomaPaneMaximum(windowWidth: number): number {
  return Math.max(
    KOMA_PANE_MIN_WIDTH,
    Math.min(KOMA_PANE_MAX_WIDTH, windowWidth - CANVAS_MIN_WIDTH - CHAT_MIN_WIDTH),
  );
}

export function parseKomaPanePreferences(raw: string | null): KomaPanePreferences {
  if (raw === null) return DEFAULT_KOMA_PANE;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_KOMA_PANE;
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_KOMA_PANE;
  return {
    open: 'open' in value && typeof value.open === 'boolean' ? value.open : true,
    width:
      'width' in value && typeof value.width === 'number' && Number.isFinite(value.width)
        ? clampKomaPaneWidth(value.width)
        : KOMA_PANE_DEFAULT_WIDTH,
    details: 'details' in value && typeof value.details === 'boolean' ? value.details : false,
  };
}

export function loadKomaPanePreferences(): KomaPanePreferences {
  try {
    return parseKomaPanePreferences(
      typeof localStorage === 'undefined' ? null : localStorage.getItem(KOMA_PANE_PREFERENCES_KEY),
    );
  } catch {
    return DEFAULT_KOMA_PANE;
  }
}

export function saveKomaPanePreferences(preferences: KomaPanePreferences): void {
  try {
    localStorage.setItem(KOMA_PANE_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    /* Preferences must never prevent document editing. */
  }
}
