import { describe, expect, it } from 'vitest';
import { PIXEL_COLORS, SPRITE_ANIMATIONS, SPRITE_SIZE } from './pixelSprite';
import { ACTIVITY_PHASES } from './runActivity';

describe('pixel character', () => {
  it('has a pose for every observed phase, inside the grid', () => {
    for (const phase of ACTIVITY_PHASES) {
      const animation = SPRITE_ANIMATIONS[phase];
      expect(animation.frames.length).toBeGreaterThan(0);
      expect(animation.frameMs === 0).toBe(animation.frames.length === 1);
      for (const frame of animation.frames) {
        expect(frame.length).toBeGreaterThan(40);
        for (const [x, y, color] of frame) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(SPRITE_SIZE);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThan(SPRITE_SIZE);
          expect(Object.keys(PIXEL_COLORS)).toContain(color);
        }
      }
    }
  });

  it('shows each phase differently in its still pose', () => {
    const stills = ACTIVITY_PHASES.map((phase) =>
      JSON.stringify(SPRITE_ANIMATIONS[phase].frames[0]),
    );
    expect(new Set(stills).size).toBe(ACTIVITY_PHASES.length);
  });

  it('keeps the failed pose still', () => {
    expect(SPRITE_ANIMATIONS.failed.frames).toHaveLength(1);
  });
});
