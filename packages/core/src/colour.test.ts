import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  hexColourSchema,
  mixColours,
  parseColour,
  pickReadableColour,
} from './colour';

describe('parseColour', () => {
  it.each([
    ['#ff5a36', '#FF5A36'],
    ['FF5A36', '#FF5A36'],
    ['#abc', '#AABBCC'],
    ['  #0e0f13 ', '#0E0F13'],
  ])('normalises %s to %s', (input, expected) => {
    expect(parseColour(input)).toEqual({ ok: true, value: expected });
  });

  it.each(['', 'red', '#12345', '#GGGGGG', 'rgb(0,0,0)', '#1234567'])('rejects "%s"', (input) => {
    const result = parseColour(input);
    expect(result.ok).toBe(false);
  });
});

describe('hexColourSchema', () => {
  it('stores colours in uppercase', () => {
    expect(hexColourSchema.parse('#ff5a36')).toBe('#FF5A36');
  });

  it('rejects shorthand and named colours', () => {
    expect(hexColourSchema.safeParse('#abc').success).toBe(false);
    expect(hexColourSchema.safeParse('tomato').success).toBe(false);
  });
});

describe('mixColours', () => {
  it('returns the endpoints at 0 and 1', () => {
    expect(mixColours('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mixColours('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
  });

  it('interpolates each channel', () => {
    expect(mixColours('#000000', '#FF8000', 0.5)).toBe('#804000');
  });

  it('clamps the amount', () => {
    expect(mixColours('#000000', '#FFFFFF', 4)).toBe('#FFFFFF');
  });
});

describe('contrast', () => {
  it('measures black on white as 21:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  it('picks the most readable candidate', () => {
    expect(pickReadableColour('#F2C14E', ['#F2EFE9', '#0E0F13'])).toBe('#0E0F13');
  });
});
