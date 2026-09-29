import type { AssetReference } from '@koma-motion/core';
import { buildKoma, buildShape } from '@koma-motion/core/testing';
import { buildTransition, komaToFrame } from '@koma-motion/motion-engine';
import { describe, expect, it } from 'vitest';
import { createAssetResolver } from './assets';
import { clampZoom, getFitScale } from './layout';
import { advancePlayback, getPreviewFrame } from './preview';

const asset: AssetReference = {
  id: 'asset-logo',
  type: 'image',
  name: 'logo.png',
  mediaType: 'image/png',
  projectPath: 'assets/logo.png',
  metadata: {},
  embeddedData: { encoding: 'base64', data: 'iVBORw0KGgo=' },
};

describe('createAssetResolver', () => {
  it('builds a data URL from the bytes stored in the project', () => {
    expect(createAssetResolver([asset])('asset-logo')).toEqual({
      status: 'available',
      url: 'data:image/png;base64,iVBORw0KGgo=',
      name: 'logo.png',
    });
  });

  it('reports an asset that is not part of the project', () => {
    const resolved = createAssetResolver([asset])('asset-other');
    expect(resolved.status).toBe('missing');
  });

  it('reports an asset without data', () => {
    const resolved = createAssetResolver([{ ...asset, embeddedData: null }])('asset-logo');
    expect(resolved).toEqual({
      status: 'missing',
      reason: 'The image data of "logo.png" is not stored in this project.',
    });
  });

  it('never returns a URL for data that is not base64', () => {
    const resolved = createAssetResolver([
      { ...asset, embeddedData: { encoding: 'base64', data: '"><script>alert(1)</script>' } },
    ])('asset-logo');
    expect(resolved.status).toBe('missing');
  });
});

describe('getFitScale', () => {
  const canvas = { width: 1920, height: 1080 };

  it('fits the canvas into a wide area by height', () => {
    expect(getFitScale(canvas, { width: 3000, height: 540 })).toBe(0.5);
  });

  it('fits the canvas into a tall area by width', () => {
    expect(getFitScale(canvas, { width: 960, height: 2000 })).toBe(0.5);
  });

  it('respects padding and never becomes negative', () => {
    expect(getFitScale(canvas, { width: 1000, height: 2000 }, 20)).toBe(0.5);
    expect(getFitScale(canvas, { width: 10, height: 10 }, 20)).toBe(0);
  });

  it('clamps the zoom', () => {
    expect(clampZoom(0.01)).toBe(0.25);
    expect(clampZoom(9)).toBe(4);
    expect(clampZoom(1.5)).toBe(1.5);
  });
});

describe('advancePlayback', () => {
  it('advances in proportion to the elapsed time', () => {
    expect(advancePlayback({ status: 'playing', progress: 0.25 }, 250, 1000)).toEqual({
      status: 'playing',
      progress: 0.5,
    });
  });

  it('finishes at the end', () => {
    expect(advancePlayback({ status: 'playing', progress: 0.9 }, 500, 1000)).toEqual({
      status: 'finished',
      progress: 1,
    });
  });

  it('does not move while paused', () => {
    const paused = { status: 'paused', progress: 0.4 } as const;
    expect(advancePlayback(paused, 500, 1000)).toBe(paused);
  });
});

describe('getPreviewFrame', () => {
  const engine = buildShape({ id: 'engine-1', persistentId: 'engine', position: { x: 0, y: 0 } });
  const from = buildKoma({ id: 'koma-1', elements: [engine] });
  const to = buildKoma({
    id: 'koma-2',
    elements: [{ ...engine, id: 'engine-2', position: { x: 400, y: 0 } }],
  });
  const built = buildTransition({ id: 't', from, to, suggestion: { easing: 'linear' } });
  if (!built.ok) {
    throw new Error('Expected a transition');
  }
  const { transition } = built.value;

  it('interpolates when motion is allowed', () => {
    const frame = getPreviewFrame({ from, to, transition, progress: 0.5, reducedMotion: false });
    expect(frame.layers[0]?.element.position).toEqual({ x: 200, y: 0 });
  });

  it.each([false, true])(
    'stays on the source until the end when blocked (reduced motion: %s)',
    (reducedMotion) => {
      const at = (progress: number): ReturnType<typeof getPreviewFrame> =>
        getPreviewFrame({ from, to, transition, progress, reducedMotion, blocked: true });
      expect(at(0.6)).toEqual(komaToFrame(from));
      expect(at(0.99)).toEqual(komaToFrame(from));
      expect(at(1)).toEqual(komaToFrame(to));
    },
  );

  it.each([false, true])(
    'does not play operations that refer to the wrong element (reduced motion: %s)',
    (reducedMotion) => {
      const invalid = {
        ...transition,
        elementTransitions: transition.elementTransitions.map((item) => ({
          ...item,
          to: item.to === null ? null : { ...item.to, elementId: 'element-invented' },
        })),
      };
      const at = (progress: number): ReturnType<typeof getPreviewFrame> =>
        getPreviewFrame({ from, to, transition: invalid, progress, reducedMotion });
      expect(at(0.6)).toEqual(komaToFrame(from));
      expect(at(1)).toEqual(komaToFrame(to));
    },
  );

  it('cuts from one Koma to the next with reduced motion', () => {
    const before = getPreviewFrame({ from, to, transition, progress: 0.49, reducedMotion: true });
    const after = getPreviewFrame({ from, to, transition, progress: 0.5, reducedMotion: true });
    expect(before).toEqual(komaToFrame(from));
    expect(after).toEqual(komaToFrame(to));
  });
});
