import { contrastRatio, type BrandKit } from '@koma-motion/core';

/** WCAG 2.x AA thresholds. */
export const MIN_TEXT_CONTRAST = 4.5;
export const MIN_GRAPHIC_CONTRAST = 3;

export interface ContrastFinding {
  readonly id: 'textOnBackground' | 'primaryOnBackground' | 'accentOnBackground';
  readonly label: string;
  readonly ratio: number;
  readonly minimum: number;
  readonly passes: boolean;
}

/** Checks the colour pairs that every generated Koma relies on. */
export function assessBrandKitContrast(brandKit: BrandKit): ContrastFinding[] {
  const { colours } = brandKit;
  const finding = (
    id: ContrastFinding['id'],
    label: string,
    foreground: string,
    minimum: number,
  ): ContrastFinding => {
    const ratio = contrastRatio(foreground, colours.background);
    return { id, label, ratio, minimum, passes: ratio >= minimum };
  };
  return [
    finding('textOnBackground', 'Text on background', colours.text, MIN_TEXT_CONTRAST),
    finding('primaryOnBackground', 'Primary on background', colours.primary, MIN_GRAPHIC_CONTRAST),
    finding('accentOnBackground', 'Accent on background', colours.accent, MIN_GRAPHIC_CONTRAST),
  ];
}
