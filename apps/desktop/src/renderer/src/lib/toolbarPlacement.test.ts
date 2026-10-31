import { describe, expect, it } from 'vitest';
import { placeToolbar, TOOLBAR_GAP, TOOLBAR_MARGIN } from './toolbarPlacement';

const area = { left: 0, top: 50, right: 1000, bottom: 650 };
const size = { width: 220, height: 40 };

describe('element toolbar placement', () => {
  it('centres the toolbar above a selection with room', () => {
    const placement = placeToolbar({ left: 400, top: 300, right: 600, bottom: 400 }, area, size);
    expect(placement).toEqual({ x: 390, y: 300 - TOOLBAR_GAP - 40, side: 'above' });
  });

  it('moves below a selection at the top edge', () => {
    const placement = placeToolbar({ left: 400, top: 60, right: 600, bottom: 160 }, area, size);
    expect(placement).toEqual({ x: 390, y: 160 + TOOLBAR_GAP, side: 'below' });
  });

  it('stays inside the area for a selection that fills it', () => {
    const placement = placeToolbar({ left: -50, top: 20, right: 1100, bottom: 700 }, area, size);
    expect(placement.side).toBe('inside');
    expect(placement.y).toBe(area.top + TOOLBAR_MARGIN);
  });

  it('keeps an edge selection reachable horizontally', () => {
    const left = placeToolbar({ left: -40, top: 300, right: 20, bottom: 360 }, area, size);
    expect(left.x).toBe(area.left + TOOLBAR_MARGIN);
    const right = placeToolbar({ left: 980, top: 300, right: 1040, bottom: 360 }, area, size);
    expect(right.x).toBe(area.right - TOOLBAR_MARGIN - size.width);
  });

  it('starts at the area edge when the area is narrower than the toolbar', () => {
    const narrow = { left: 0, top: 0, right: 100, bottom: 400 };
    expect(placeToolbar({ left: 10, top: 200, right: 90, bottom: 260 }, narrow, size).x).toBe(
      TOOLBAR_MARGIN,
    );
  });
});
