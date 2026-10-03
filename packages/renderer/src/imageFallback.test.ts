// @vitest-environment jsdom
import { buildShape } from '@koma-motion/core/testing';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { ElementView } from './ElementView';

it('shows a placeholder after decoding fails, then permits a replacement URL to load', () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const element = {
    ...buildShape(),
    type: 'image' as const,
    content: { assetId: 'photo', altText: 'Photo' },
    style: { fit: 'contain' as const, cornerRadius: 0 },
  };
  const render = (url: string) =>
    root.render(
      createElement(ElementView, {
        element,
        resolveAsset: () => ({ status: 'available' as const, name: 'Photo', url }),
        selected: false,
        outlineWidth: 1,
      }),
    );
  try {
    act(() => render('data:image/png;base64,YmFk'));
    expect(host.querySelector('img')).not.toBeNull();
    act(() => {
      host.querySelector('img')!.dispatchEvent(new Event('error'));
    });
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('Missing image');
    act(() => render('data:image/png;base64,bmV3'));
    expect(host.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,bmV3');
  } finally {
    act(() => root.unmount());
  }
});
