import { brandKitSchema, systemInstructionsSchema } from '@koma-motion/core';
import { describe, expect, it } from 'vitest';
import { assessBrandKitContrast } from './contrast';
import { getStarterPreset, STARTER_PRESETS } from './starters';

describe('STARTER_PRESETS', () => {
  it('offers the solar system, finance and Rapunzel starters', () => {
    expect(STARTER_PRESETS.map((preset) => preset.id)).toEqual([
      'solar-system',
      'finance-report',
      'rapunzel',
    ]);
    expect(getStarterPreset('rapunzel').name).toBe('Rapunzel story');
  });

  it.each(STARTER_PRESETS)('$name has a valid, readable Brand Kit and instructions', (preset) => {
    expect(brandKitSchema.safeParse(preset.brandKit).success).toBe(true);
    expect(assessBrandKitContrast(preset.brandKit).every((finding) => finding.passes)).toBe(true);
    expect(systemInstructionsSchema.safeParse(preset.systemInstructions).success).toBe(true);
    expect(preset.request.trim().length).toBeGreaterThan(0);
    expect(preset.komaCount).toBeGreaterThanOrEqual(3);
  });

  it('asks for shapes and persistent motion rather than images', () => {
    for (const preset of STARTER_PRESETS) {
      expect(preset.systemInstructions).toContain('Do not use image elements');
      expect(preset.systemInstructions).toContain('persistentId');
      expect(preset.brandKit.logoAssetId).toBeNull();
    }
  });
});
