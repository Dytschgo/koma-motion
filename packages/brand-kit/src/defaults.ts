import type { BrandKit } from '@koma-motion/core';

/** Font families offered by the editor. All of them are common system fonts. */
export const FONT_SUGGESTIONS = [
  'Georgia',
  'Times New Roman',
  'Palatino',
  'Arial',
  'Helvetica Neue',
  'Segoe UI',
  'Verdana',
  'Trebuchet MS',
  'Courier New',
] as const;

/** The Brand Kit of a new project: ink, paper, vermilion, indigo and amber. */
export function createDefaultBrandKit(): BrandKit {
  return {
    name: 'Untitled brand',
    colours: {
      primary: '#FF5A36',
      secondary: '#2B3A55',
      accent: '#F2C14E',
      background: '#0E0F13',
      text: '#F2EFE9',
    },
    typography: {
      headingFont: 'Georgia',
      bodyFont: 'Segoe UI',
    },
    logoAssetId: null,
    tone: '',
    visualStyle: '',
    iconStyle: '',
    preferredImagery: '',
    preferredTopics: [],
    referenceNotes: '',
  };
}
