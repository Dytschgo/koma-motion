import { getCanvasSize, type Koma, type Presentation } from '@koma-motion/core';
import { komaToFrame } from '@koma-motion/motion-engine';
import { KomaStage, type AssetResolver } from '@koma-motion/renderer';
import { memo, useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';

interface ThumbnailProps {
  readonly koma: Koma;
  readonly aspectRatio: Presentation['aspectRatio'];
  readonly resolveAsset: AssetResolver;
  readonly width: number;
  readonly scrollRoot: RefObject<HTMLElement | null>;
}

function ThumbnailStage({
  koma,
  aspectRatio,
  resolveAsset,
  width,
}: Omit<ThumbnailProps, 'scrollRoot'>): ReactElement {
  const canvasSize = getCanvasSize(aspectRatio);
  return (
    <KomaStage
      frame={komaToFrame(koma)}
      canvasSize={canvasSize}
      scale={width / canvasSize.width}
      resolveAsset={resolveAsset}
      label={koma.title}
    />
  );
}

/** Keep the full deck navigable while only drawing nearby thumbnails. */
export const KomaThumbnail = memo(function KomaThumbnail({
  koma,
  aspectRatio,
  resolveAsset,
  width,
  scrollRoot,
}: ThumbnailProps): ReactElement {
  const target = useRef<HTMLDivElement>(null);
  const [nearby, setNearby] = useState(false);
  const canvasSize = getCanvasSize(aspectRatio);
  useEffect(() => {
    const node = target.current;
    if (node === null) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry !== undefined) setNearby(entry.isIntersecting);
      },
      { root: scrollRoot.current, rootMargin: '240px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [scrollRoot]);

  return (
    <div
      ref={target}
      aria-hidden="true"
      data-koma-thumbnail=""
      className="koma-thumbnail"
      style={{
        inlineSize: width,
        aspectRatio: `${String(canvasSize.width)} / ${String(canvasSize.height)}`,
      }}
    >
      {nearby && (
        <ThumbnailStage
          koma={koma}
          aspectRatio={aspectRatio}
          resolveAsset={resolveAsset}
          width={width}
        />
      )}
    </div>
  );
});
