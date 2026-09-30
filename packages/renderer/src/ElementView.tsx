import type {
  GroupElement,
  ImageElement,
  KomaElement,
  LeafElement,
  ShapeElement,
  TextElement,
} from '@koma-motion/core';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactElement } from 'react';
import type { AssetResolver } from './assets';

const JUSTIFY_BY_VERTICAL_ALIGN = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
} as const;

function TextContent({ element }: { readonly element: TextElement }): ReactElement {
  const { style } = element;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: JUSTIFY_BY_VERTICAL_ALIGN[style.verticalAlign],
        fontFamily: `${style.fontFamily}, system-ui, sans-serif`,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        color: style.colour,
        textAlign: style.textAlign,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
      }}
    >
      <span>{element.content.text}</span>
    </div>
  );
}

function ShapeContent({ element }: { readonly element: ShapeElement }): ReactElement {
  const { width, height } = element.size;
  const { fill, stroke } = element.style;
  const strokeWidth = stroke === null ? 0 : element.style.strokeWidth;
  const paint = {
    fill: fill ?? 'none',
    stroke: stroke ?? 'none',
    strokeWidth,
  };
  const inset = strokeWidth / 2;
  const innerWidth = Math.max(0, width - strokeWidth);
  const innerHeight = Math.max(0, height - strokeWidth);

  let shape: ReactElement;
  switch (element.content.shape) {
    case 'rectangle':
      shape = <rect x={inset} y={inset} width={innerWidth} height={innerHeight} {...paint} />;
      break;
    case 'roundedRectangle': {
      const radius = Math.min(element.content.cornerRadius, innerWidth / 2, innerHeight / 2);
      shape = (
        <rect
          x={inset}
          y={inset}
          width={innerWidth}
          height={innerHeight}
          rx={radius}
          ry={radius}
          {...paint}
        />
      );
      break;
    }
    case 'circle':
      shape = (
        <ellipse
          cx={width / 2}
          cy={height / 2}
          rx={innerWidth / 2}
          ry={innerHeight / 2}
          {...paint}
        />
      );
      break;
    case 'line':
      shape = (
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={stroke ?? fill ?? 'none'}
          strokeWidth={element.style.strokeWidth}
          strokeLinecap="round"
        />
      );
      break;
  }

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      preserveAspectRatio="none"
      style={{ display: 'block', overflow: 'visible' }}
      aria-hidden="true"
    >
      {shape}
    </svg>
  );
}

function ImageContent({
  element,
  resolveAsset,
}: {
  readonly element: ImageElement;
  readonly resolveAsset: AssetResolver;
}): ReactElement {
  const asset = resolveAsset(element.content.assetId);
  const radius = element.style.cornerRadius;
  if (asset.status === 'missing') {
    return (
      <div
        role="img"
        aria-label={`Missing image: ${element.name}`}
        title={asset.reason}
        style={{
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '3px dashed rgba(255, 255, 255, 0.55)',
          borderRadius: radius,
          background:
            'repeating-linear-gradient(45deg, rgba(128,128,128,0.35) 0 16px, rgba(128,128,128,0.2) 16px 32px)',
          color: '#FFFFFF',
          font: '600 28px system-ui, sans-serif',
          textAlign: 'center',
          overflow: 'hidden',
        }}
      >
        Missing image
      </div>
    );
  }
  return (
    <img
      src={asset.url}
      alt={element.content.altText}
      draggable={false}
      style={{
        width: '100%',
        height: '100%',
        objectFit: element.style.fit,
        borderRadius: radius,
        display: 'block',
      }}
    />
  );
}

function GroupContent({
  element,
  resolveAsset,
}: {
  readonly element: GroupElement;
  readonly resolveAsset: AssetResolver;
}): ReactElement {
  const { referenceSize, children } = element.content;
  const scaleX = element.size.width / referenceSize.width;
  const scaleY = element.size.height / referenceSize.height;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: referenceSize.width,
        height: referenceSize.height,
        transform: `scale(${String(scaleX)}, ${String(scaleY)})`,
        transformOrigin: '0 0',
      }}
    >
      {children
        .filter((child) => child.visible)
        .map((child) => (
          <div key={child.id} style={getBoxStyle(child)}>
            <ElementContent element={child} resolveAsset={resolveAsset} />
          </div>
        ))}
    </div>
  );
}

function ElementContent({
  element,
  resolveAsset,
}: {
  readonly element: KomaElement | LeafElement;
  readonly resolveAsset: AssetResolver;
}): ReactElement {
  switch (element.type) {
    case 'text':
      return <TextContent element={element} />;
    case 'shape':
      return <ShapeContent element={element} />;
    case 'image':
      return <ImageContent element={element} resolveAsset={resolveAsset} />;
    case 'group':
      return <GroupContent element={element} resolveAsset={resolveAsset} />;
  }
}

/** Maps the geometry of an element to CSS. One logical unit is one CSS pixel before scaling. */
export function getBoxStyle(element: KomaElement | LeafElement): CSSProperties {
  return {
    position: 'absolute',
    left: element.position.x,
    top: element.position.y,
    width: element.size.width,
    height: element.size.height,
    transform: element.rotation === 0 ? undefined : `rotate(${String(element.rotation)}deg)`,
    transformOrigin: '50% 50%',
    opacity: element.opacity,
    zIndex: element.zIndex,
  };
}

export interface ElementViewProps {
  readonly element: KomaElement;
  readonly resolveAsset: AssetResolver;
  readonly selected: boolean;
  readonly editingText?: boolean;
  /** Width of the selection outline in logical units. */
  readonly outlineWidth: number;
  /** When given, the element can be selected with pointer and keyboard. */
  readonly onSelect?: ((elementId: string) => void) | undefined;
  readonly onManipulate?:
    ((event: PointerEvent<HTMLDivElement>, element: KomaElement) => void) | undefined;
  readonly onEditText?: (() => void) | undefined;
  readonly onElementKeyDown?:
    ((event: KeyboardEvent<HTMLDivElement>, element: KomaElement) => void) | undefined;
}

export function ElementView({
  element,
  resolveAsset,
  selected,
  editingText = false,
  outlineWidth,
  onSelect,
  onManipulate,
  onEditText,
  onElementKeyDown,
}: ElementViewProps): ReactElement {
  const interactive = onSelect !== undefined;
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    onElementKeyDown?.(event, element);
    if (event.defaultPrevented) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect?.(element.id);
    }
  };

  return (
    <div
      data-element-id={element.id}
      data-persistent-id={element.persistentId}
      data-selected={selected ? 'true' : undefined}
      style={{
        ...getBoxStyle(element),
        cursor: interactive ? (element.locked ? 'pointer' : 'move') : undefined,
        userSelect: interactive ? 'none' : undefined,
        touchAction: interactive ? 'none' : undefined,
        outline:
          interactive && selected
            ? `${String(outlineWidth)}px solid var(--koma-selection, #FF5A36)`
            : undefined,
        outlineOffset: selected ? outlineWidth * 2 : undefined,
      }}
      {...(interactive
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-label': `${element.name} (${element.type})`,
            'aria-pressed': selected,
            onPointerDown: (event) => {
              event.stopPropagation();
              if (event.button !== 0) return;
              event.currentTarget.focus({ preventScroll: true });
              onSelect(element.id);
              onManipulate?.(event, element);
            },
            onDoubleClick: onEditText,
            onKeyDown: handleKeyDown,
          }
        : {})}
    >
      <div
        style={{ width: '100%', height: '100%', visibility: editingText ? 'hidden' : undefined }}
      >
        <ElementContent element={element} resolveAsset={resolveAsset} />
      </div>
    </div>
  );
}
