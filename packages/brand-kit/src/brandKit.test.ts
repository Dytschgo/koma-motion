import { brandKitSchema } from '@koma-motion/core';
import { buildBrandKit } from '@koma-motion/core/testing';
import { describe, expect, it } from 'vitest';
import { toBrandKitContext } from './context';
import { assessBrandKitContrast } from './contrast';
import { createDefaultBrandKit } from './defaults';
import {
  commitBrandKitField,
  editBrandKitField,
  parseTopics,
  pruneBrandKitRawDraft,
  toBrandKitDraft,
  validateBrandKitDraft,
  type BrandKitRawDraft,
} from './draft';

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

describe('commitBrandKitField', () => {
  it('stores a trimmed name and leaves the raw string with the caller', () => {
    const brandKit = buildBrandKit({ name: 'Acme' });
    const edited = editBrandKitField(brandKit, {}, 'name', 'Acme ');
    expect(edited.error).toBeNull();
    expect(edited.brandKit).toBe(brandKit);
    expect(edited.brandKit.name).toBe('Acme');
    expect(edited.raw.name).toBe('Acme ');
    expect(brandKitSchema.safeParse(edited.brandKit).success).toBe(true);
  });

  it('keeps internal spaces in a stored name and font', () => {
    const brandKit = buildBrandKit();
    const named = commitBrandKitField(brandKit, 'name', '  Acme Corp  ');
    expect(named.error).toBeNull();
    expect(named.brandKit.name).toBe('Acme Corp');
    const font = commitBrandKitField(named.brandKit, 'headingFont', 'Times New Roman');
    expect(font.brandKit.typography.headingFont).toBe('Times New Roman');
    expect(brandKitSchema.safeParse(font.brandKit).success).toBe(true);
  });

  it('commits a valid name, font and topics while a colour is invalid', () => {
    let brandKit = buildBrandKit({ name: 'Old', preferredTopics: ['keep'] });
    let raw: BrandKitRawDraft = {};
    const colour = editBrandKitField(brandKit, raw, 'colours.primary', 'nope');
    expect(colour.error).not.toBeNull();
    expect(colour.brandKit).toBe(brandKit);
    expect(colour.brandKit.colours.primary).toBe(brandKit.colours.primary);
    raw = colour.raw;

    const name = editBrandKitField(brandKit, raw, 'name', 'Acme Corp');
    expect(name.error).toBeNull();
    expect(name.brandKit.name).toBe('Acme Corp');
    expect(name.raw.colours?.primary).toBe('nope');
    brandKit = name.brandKit;
    raw = name.raw;

    const font = editBrandKitField(brandKit, raw, 'bodyFont', 'Times New Roman');
    expect(font.error).toBeNull();
    expect(font.brandKit.typography.bodyFont).toBe('Times New Roman');
    brandKit = font.brandKit;
    raw = font.raw;

    const topics = editBrandKitField(brandKit, raw, 'preferredTopics', 'motion, design');
    expect(topics.error).toBeNull();
    expect(topics.brandKit.preferredTopics).toEqual(['motion', 'design']);
    expect(topics.raw.colours?.primary).toBe('nope');
    expect(topics.raw.name).toBe('Acme Corp');
    expect(topics.raw.bodyFont).toBe('Times New Roman');
    expect(brandKitSchema.safeParse(topics.brandKit).success).toBe(true);
  });

  it('does not clear topics when the text is invalid', () => {
    const brandKit = buildBrandKit({ preferredTopics: ['motion', 'design'] });
    const tooLong = 'x'.repeat(121);
    const edited = editBrandKitField(
      brandKit,
      { name: 'Acme ', preferredTopics: 'motion, design' },
      'preferredTopics',
      tooLong,
    );
    expect(edited.error).not.toBeNull();
    expect(edited.brandKit).toBe(brandKit);
    expect(edited.brandKit.preferredTopics).toEqual(['motion', 'design']);
    expect(edited.raw.preferredTopics).toBe(tooLong);
    expect(edited.raw.name).toBe('Acme ');
    expect(brandKitSchema.safeParse(edited.brandKit).success).toBe(true);
  });

  it('does not replace a font with an empty name', () => {
    const brandKit = buildBrandKit();
    const edited = editBrandKitField(brandKit, { bodyFont: 'Segoe UI' }, 'bodyFont', '   ');
    expect(edited.error).not.toBeNull();
    expect(edited.brandKit).toBe(brandKit);
    expect(edited.brandKit.typography.bodyFont).toBe(brandKit.typography.bodyFont);
    expect(edited.raw.bodyFont).toBe('   ');
  });

  it('stores a normalised colour only when the text parses', () => {
    const brandKit = buildBrandKit();
    const stored = commitBrandKitField(brandKit, 'colours.accent', ' #f2c14e ');
    expect(stored.error).toBeNull();
    expect(stored.brandKit.colours.accent).toBe('#F2C14E');
    expect(stored.brandKit.colours.primary).toBe(brandKit.colours.primary);
    expect(brandKitSchema.safeParse(stored.brandKit).success).toBe(true);

    const unchanged = commitBrandKitField(stored.brandKit, 'colours.accent', '#F2C14E');
    expect(unchanged.brandKit).toBe(stored.brandKit);
  });
});

describe('pruneBrandKitRawDraft', () => {
  it('drops a valid unfocused override and keeps invalid text and the focused field', () => {
    const brandKit = buildBrandKit({ name: 'Stored', preferredTopics: ['motion'] });
    const raw: BrandKitRawDraft = {
      name: 'Acme Corp ',
      bodyFont: 'Times New Roman',
      colours: { primary: 'nope' },
      preferredTopics: 'x'.repeat(121),
    };
    const pruned = pruneBrandKitRawDraft(brandKit, raw, null);
    expect(pruned.name).toBeUndefined();
    expect(pruned.bodyFont).toBeUndefined();
    expect(pruned.colours?.primary).toBe('nope');
    expect(pruned.preferredTopics).toBe(raw.preferredTopics);

    const focused = pruneBrandKitRawDraft(brandKit, raw, 'name');
    expect(focused.name).toBe('Acme Corp ');
    expect(focused.colours?.primary).toBe('nope');
    expect(focused.preferredTopics).toBe(raw.preferredTopics);
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
