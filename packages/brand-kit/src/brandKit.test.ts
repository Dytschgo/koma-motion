import { brandKitSchema } from '@koma-motion/core';
import { buildBrandKit } from '@koma-motion/core/testing';
import { describe, expect, it } from 'vitest';
import { toBrandKitContext } from './context';
import { assessBrandKitContrast } from './contrast';
import { createDefaultBrandKit } from './defaults';
import { parseTopics, toBrandKitDraft, validateBrandKitDraft } from './draft';

describe('createDefaultBrandKit', () => {
  it('is a valid Brand Kit with readable colours', () => {
    const brandKit = createDefaultBrandKit();
    expect(brandKitSchema.safeParse(brandKit).success).toBe(true);
    expect(assessBrandKitContrast(brandKit).every((finding) => finding.passes)).toBe(true);
  });
});

describe('validateBrandKitDraft', () => {
  it('round-trips a valid Brand Kit', () => {
    const brandKit = buildBrandKit();
    expect(validateBrandKitDraft(toBrandKitDraft(brandKit))).toEqual({ ok: true, brandKit });
  });

  it('normalises colours to one stored format', () => {
    const draft = toBrandKitDraft(buildBrandKit());
    const result = validateBrandKitDraft({
      ...draft,
      colours: { ...draft.colours, primary: 'abc', accent: '#f2c14e' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.brandKit.colours.primary).toBe('#AABBCC');
      expect(result.brandKit.colours.accent).toBe('#F2C14E');
    }
  });

  it('reports every invalid colour by field', () => {
    const draft = toBrandKitDraft(buildBrandKit());
    const result = validateBrandKitDraft({
      ...draft,
      colours: { ...draft.colours, primary: 'tomato', text: '#12' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(['colours.primary', 'colours.text']);
      expect(result.errors['colours.primary']).toContain('tomato');
    }
  });

  it('rejects unsafe font names', () => {
    const draft = toBrandKitDraft(buildBrandKit());
    const result = validateBrandKitDraft({ ...draft, headingFont: 'Arial; url(evil)' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveProperty('headingFont');
    }
  });

  it('rejects an empty font', () => {
    const draft = toBrandKitDraft(buildBrandKit());
    const result = validateBrandKitDraft({ ...draft, bodyFont: '  ' });
    expect(result.ok).toBe(false);
  });
});

describe('parseTopics', () => {
  it('splits, trims and de-duplicates', () => {
    expect(parseTopics('motion, design\n motion ,, story')).toEqual(['motion', 'design', 'story']);
  });
});

describe('assessBrandKitContrast', () => {
  it('flags unreadable text', () => {
    const brandKit = buildBrandKit();
    const findings = assessBrandKitContrast({
      ...brandKit,
      colours: { ...brandKit.colours, text: '#15161A' },
    });
    expect(findings.find((finding) => finding.id === 'textOnBackground')?.passes).toBe(false);
  });
});

describe('toBrandKitContext', () => {
  it('describes the logo without image data', () => {
    const brandKit = buildBrandKit({ logoAssetId: 'asset-logo' });
    const context = toBrandKitContext(brandKit, [
      {
        id: 'asset-logo',
        type: 'image',
        name: 'logo.png',
        mediaType: 'image/png',
        projectPath: 'assets/logo.png',
        metadata: {},
        embeddedData: { encoding: 'base64', data: 'AAAA' },
      },
    ]);
    expect(context.logo).toEqual({ assetId: 'asset-logo', name: 'logo.png' });
    expect(JSON.stringify(context)).not.toContain('AAAA');
  });

  it('omits a logo whose asset is missing', () => {
    const context = toBrandKitContext(buildBrandKit({ logoAssetId: 'asset-logo' }), []);
    expect(context.logo).toBeNull();
  });
});
