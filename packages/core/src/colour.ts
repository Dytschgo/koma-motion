import { z } from 'zod';
import { err, ok, type Result } from './result';

/**
 * Koma Motion stores every colour as an opaque six-digit uppercase hex string
 * such as `#FF5A36`. Transparency is expressed through element opacity.
 */
export type HexColour = string;

const STORED_COLOUR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const SHORT_COLOUR_PATTERN = /^#?([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/;
const LONG_COLOUR_PATTERN = /^#?([0-9a-fA-F]{6})$/;

export const hexColourSchema = z
  .string()
  .regex(STORED_COLOUR_PATTERN, 'Colour must be a six-digit hex value such as #FF5A36')
  .transform((value) => value.toUpperCase());

export interface RgbColour {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Parses user or agent input (`#abc`, `abc`, `#aabbcc`, `AABBCC`) into the stored format. */
export function parseColour(input: string): Result<HexColour, string> {
  const trimmed = input.trim();
  const long = LONG_COLOUR_PATTERN.exec(trimmed);
  if (long?.[1] !== undefined) {
    return ok(`#${long[1].toUpperCase()}`);
  }
  const short = SHORT_COLOUR_PATTERN.exec(trimmed);
  if (short) {
    const [, r = '', g = '', b = ''] = short;
    return ok(`#${r}${r}${g}${g}${b}${b}`.toUpperCase());
  }
  return err(`"${input}" is not a valid hex colour. Use a value such as #FF5A36.`);
}

export function isHexColour(input: string): boolean {
  return STORED_COLOUR_PATTERN.test(input);
}

export function hexToRgb(colour: HexColour): RgbColour {
  const value = Number.parseInt(colour.slice(1), 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

export function rgbToHex({ r, g, b }: RgbColour): HexColour {
  const channel = (value: number): string =>
    Math.min(255, Math.max(0, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

/** Linear interpolation between two colours in sRGB. `amount` is clamped to 0..1. */
export function mixColours(from: HexColour, to: HexColour, amount: number): HexColour {
  const t = Math.min(1, Math.max(0, amount));
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(colour: HexColour): number {
  const { r, g, b } = hexToRgb(colour);
  const linear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2.x contrast ratio between 1 and 21. */
export function contrastRatio(a: HexColour, b: HexColour): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Returns the candidate with the highest contrast against `background`. */
export function pickReadableColour(
  background: HexColour,
  candidates: readonly [HexColour, ...HexColour[]],
): HexColour {
  let best = candidates[0];
  let bestRatio = contrastRatio(background, best);
  for (const candidate of candidates.slice(1)) {
    const ratio = contrastRatio(background, candidate);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}
