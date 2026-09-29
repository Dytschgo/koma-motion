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

/** The Brand Kit of a new project: night blue, paper, coral, steel blue and sun yellow. */
export function createDefaultBrandKit(): BrandKit {
  return {
    name: 'Untitled brand',
    colours: {
      primary: '#FF7A59',
      secondary: '#33507A',
      accent: '#FFD166',
      background: '#182033',
      text: '#F5F3EE',
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
