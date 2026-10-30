import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KOMA_PANE,
  clampKomaPaneWidth,
  getKomaPaneMaximum,
  parseKomaPanePreferences,
} from './komaPane';

describe('Koma thumbnail pane preferences', () => {
  it('recovers from missing, malformed and incorrectly typed stored preferences', () => {
    for (const raw of [
      null,
      '',
      'null',
      '[]',
      'true',
      '{',
      '{"width":"wide","open":0,"details":"yes"}',
    ]) {
      expect(parseKomaPanePreferences(raw)).toEqual(DEFAULT_KOMA_PANE);
    }
    expect(parseKomaPanePreferences('{"width":9999,"open":false,"details":true}')).toEqual({
      width: 360,
      open: false,
      details: true,
    });
    expect(parseKomaPanePreferences('{"width":-100}').width).toBe(180);
  });

  it('bounds dragging and stored widths while reserving the canvas and chat', () => {
    expect(clampKomaPaneWidth(Number.NaN)).toBe(244);
    expect(clampKomaPaneWidth(Infinity)).toBe(244);
    expect(clampKomaPaneWidth(280.6)).toBe(281);
    expect(clampKomaPaneWidth(360, 220)).toBe(220);
    expect(clampKomaPaneWidth(360, 20)).toBe(180);
    expect(getKomaPaneMaximum(1480)).toBe(360);
    expect(getKomaPaneMaximum(1024)).toBe(304);
    expect(getKomaPaneMaximum(600)).toBe(180);
  });
});
