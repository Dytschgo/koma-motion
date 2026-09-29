import { z } from 'zod';
import { hexColourSchema } from '../colour';
import { idSchema } from '../ids';
import { fontFamilySchema } from './element';

export const BRAND_COLOUR_ROLES = ['primary', 'secondary', 'accent', 'background', 'text'] as const;
export type BrandColourRole = (typeof BRAND_COLOUR_ROLES)[number];

export const brandColoursSchema = z.object({
  primary: hexColourSchema,
  secondary: hexColourSchema,
  accent: hexColourSchema,
  background: hexColourSchema,
  text: hexColourSchema,
});

/** Structured brand constraints. They are project context for every generation request. */
export const brandKitSchema = z.object({
  name: z.string().max(120),
  colours: brandColoursSchema,
  typography: z.object({
    headingFont: fontFamilySchema,
    bodyFont: fontFamilySchema,
  }),
  /** References `KomaProject.assets[].id`. */
  logoAssetId: idSchema.nullable(),
  tone: z.string().max(1000),
  visualStyle: z.string().max(1000),
  iconStyle: z.string().max(1000),
  preferredImagery: z.string().max(1000),
  preferredTopics: z.array(z.string().min(1).max(120)).max(30),
  referenceNotes: z.string().max(5000),
});

export type BrandColours = z.infer<typeof brandColoursSchema>;
export type BrandKit = z.infer<typeof brandKitSchema>;
