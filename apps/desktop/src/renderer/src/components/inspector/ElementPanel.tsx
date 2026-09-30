import {
  getCanvasSize,
  IMAGE_FITS,
  MAX_ELEMENT_TEXT_LENGTH,
  SHAPE_KINDS,
  TEXT_ALIGNMENTS,
  VERTICAL_ALIGNMENTS,
  type ImageElement,
  type Koma,
  type KomaElement,
  type KomaProject,
  type ShapeElement,
  type TextElement,
} from '@koma-motion/core';
import type { ReactElement } from 'react';
import { describeElementKind, getLayerName, orderLayers, type StackMove } from '../../lib/layers';
import { chooseKomaImage } from '../../lib/projectActions';
import { changeElement, deleteElement, restackElement } from '../../state/commands';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import {
  BringForwardIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  SendBackwardIcon,
  TrashIcon,
  UnlockIcon,
  WarningIcon,
} from '../icons';
import { Button, Field, IconButton, NumberInput, Select, TextArea, TextInput } from '../ui';
import { describeLayerState, ElementTypeIcon } from './LayersPanel';
import { Chip, ColourField, Disclosure, Row, Section } from './parts';

type Change = (next: KomaElement, field: string) => void;

function TextControls({
  element,
  locked,
  change,
}: {
  readonly element: TextElement;
  readonly locked: boolean;
  readonly change: Change;
}): ReactElement {
  return (
    <Section title="Text">
      <Field label="Text">
        {(ids) => (
          <TextArea
            {...ids}
            rows={3}
            value={element.content.text}
            maxLength={MAX_ELEMENT_TEXT_LENGTH}
            disabled={locked}
            onChange={(event) => {
              change({ ...element, content: { text: event.target.value } }, 'text');
            }}
          />
        )}
      </Field>
      <Row>
        <Field label="Font size">
          {(ids) => (
            <NumberInput
              {...ids}
              value={element.style.fontSize}
              disabled={locked}
              minimum={1}
              maximum={2000}
              onValue={(fontSize) => {
                change({ ...element, style: { ...element.style, fontSize } }, 'font-size');
              }}
            />
          )}
        </Field>
        <Field label="Font weight">
          {(ids) => (
            <Select
              {...ids}
              value={element.style.fontWeight}
              disabled={locked}
              onChange={(event) => {
                change(
                  {
                    ...element,
                    style: { ...element.style, fontWeight: Number(event.target.value) },
                  },
                  'font-weight',
                );
              }}
            >
              {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => (
                <option key={weight} value={weight}>
                  {weight}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </Row>
      <ColourField
        label="Text colour"
        value={element.style.colour}
        disabled={locked}
        onValue={(colour) => {
          change({ ...element, style: { ...element.style, colour } }, 'colour');
        }}
      />
      <Row>
        <Field label="Alignment">
          {(ids) => (
            <Select
              {...ids}
              value={element.style.textAlign}
              disabled={locked}
              onChange={(event) => {
                const textAlign = TEXT_ALIGNMENTS.find((item) => item === event.target.value);
                if (textAlign !== undefined) {
                  change({ ...element, style: { ...element.style, textAlign } }, 'align');
                }
              }}
            >
              {TEXT_ALIGNMENTS.map((alignment) => (
                <option key={alignment} value={alignment}>
                  {alignment}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Vertical alignment">
          {(ids) => (
            <Select
              {...ids}
              value={element.style.verticalAlign}
              disabled={locked}
              onChange={(event) => {
                const verticalAlign = VERTICAL_ALIGNMENTS.find(
                  (item) => item === event.target.value,
                );
                if (verticalAlign !== undefined) {
                  change(
                    { ...element, style: { ...element.style, verticalAlign } },
                    'vertical-align',
                  );
                }
              }}
            >
              {VERTICAL_ALIGNMENTS.map((alignment) => (
                <option key={alignment} value={alignment}>
                  {alignment}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </Row>
      <Field label="Font family" hint="Set by the Brand Kit.">
        {(ids) => <TextInput {...ids} value={element.style.fontFamily} readOnly />}
      </Field>
    </Section>
  );
}

function ShapeControls({
  element,
  locked,
  change,
  defaults,
}: {
  readonly element: ShapeElement;
  readonly locked: boolean;
  readonly change: Change;
  /** Colours used when a fill or outline is switched on. */
  readonly defaults: { readonly fill: string; readonly stroke: string };
}): ReactElement {
  return (
    <Section title="Shape">
      <Field label="Shape">
        {(ids) => (
          <Select
            {...ids}
            value={element.content.shape}
            disabled={locked}
            onChange={(event) => {
              const shape = SHAPE_KINDS.find((item) => item === event.target.value);
              if (shape !== undefined) {
                change({ ...element, content: { ...element.content, shape } }, 'shape');
              }
            }}
          >
            <option value="rectangle">Rectangle</option>
            <option value="roundedRectangle">Rounded rectangle</option>
            <option value="circle">Circle</option>
            <option value="line">Line</option>
          </Select>
        )}
      </Field>
      {element.content.shape === 'roundedRectangle' && (
        <Field label="Corner radius">
          {(ids) => (
            <NumberInput
              {...ids}
              value={element.content.cornerRadius}
              disabled={locked}
              minimum={0}
              maximum={10000}
              onValue={(cornerRadius) => {
                change(
                  { ...element, content: { ...element.content, cornerRadius } },
                  'corner-radius',
                );
              }}
            />
          )}
        </Field>
      )}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="size-4 accent-pencil-blue"
          checked={element.style.fill !== null}
          disabled={locked}
          onChange={(event) => {
            change(
              {
                ...element,
                style: { ...element.style, fill: event.target.checked ? defaults.fill : null },
              },
              'fill-on',
            );
          }}
        />
        Fill
      </label>
      {element.style.fill !== null && (
        <ColourField
          label="Fill colour"
          value={element.style.fill}
          disabled={locked}
          onValue={(fill) => {
            change({ ...element, style: { ...element.style, fill } }, 'fill');
          }}
        />
      )}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="size-4 accent-pencil-blue"
          checked={element.style.stroke !== null}
          disabled={locked}
          onChange={(event) => {
            const on = event.target.checked;
            change(
              {
                ...element,
                style: {
                  ...element.style,
                  stroke: on ? defaults.stroke : null,
                  strokeWidth:
                    on && element.style.strokeWidth === 0 ? 4 : element.style.strokeWidth,
                },
              },
              'stroke-on',
            );
          }}
        />
        Outline
      </label>
      {element.style.stroke !== null && (
        <Row>
          <ColourField
            label="Outline colour"
            value={element.style.stroke}
            disabled={locked}
            onValue={(stroke) => {
              change({ ...element, style: { ...element.style, stroke } }, 'stroke');
            }}
          />
          <Field label="Outline width">
            {(ids) => (
              <NumberInput
                {...ids}
                value={element.style.strokeWidth}
                disabled={locked}
                minimum={0}
                maximum={1000}
                onValue={(strokeWidth) => {
                  change({ ...element, style: { ...element.style, strokeWidth } }, 'stroke-width');
                }}
              />
            )}
          </Field>
        </Row>
      )}
    </Section>
  );
}

function ImageControls({
  koma,
  element,
  project,
  locked,
  change,
}: {
  readonly koma: Koma;
  readonly element: ImageElement;
  readonly project: KomaProject;
  readonly locked: boolean;
  readonly change: Change;
}): ReactElement {
  const asset = project.assets.find((item) => item.id === element.content.assetId);
  return (
    <Section title="Image">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-ink-300" title={asset?.name}>
          {asset === undefined ? (
            <span className="text-signal-warn">The image file is missing.</span>
          ) : (
            asset.name
          )}
        </p>
        <Button
          variant="outline"
          compact
          disabled={locked}
          onClick={() => {
            void chooseKomaImage(koma.id, element.id);
          }}
        >
          Replace image
        </Button>
      </div>
      <Row>
        <Field label="Fit">
          {(ids) => (
            <Select
              {...ids}
              value={element.style.fit}
              disabled={locked}
              onChange={(event) => {
                const fit = IMAGE_FITS.find((item) => item === event.target.value);
                if (fit !== undefined) {
                  change({ ...element, style: { ...element.style, fit } }, 'fit');
                }
              }}
            >
              <option value="contain">Fit inside</option>
              <option value="cover">Fill and crop</option>
            </Select>
          )}
        </Field>
        <Field label="Corner radius">
          {(ids) => (
            <NumberInput
              {...ids}
              value={element.style.cornerRadius}
              disabled={locked}
              minimum={0}
              maximum={10000}
              onValue={(cornerRadius) => {
                change({ ...element, style: { ...element.style, cornerRadius } }, 'image-radius');
              }}
            />
          )}
        </Field>
      </Row>
      <Field label="Description for screen readers">
        {(ids) => (
          <TextInput
            {...ids}
            value={element.content.altText}
            maxLength={500}
            disabled={locked}
            onChange={(event) => {
              change(
                { ...element, content: { ...element.content, altText: event.target.value } },
                'alt',
              );
            }}
          />
        )}
      </Field>
    </Section>
  );
}

function GeometryControls({
  element,
  locked,
  change,
}: {
  readonly element: KomaElement;
  readonly locked: boolean;
  readonly change: Change;
}): ReactElement {
  return (
    <Section title="Position and size">
      <Row>
        <Field label="X">
          {(ids) => (
            <NumberInput
              {...ids}
              value={element.position.x}
              disabled={locked}
              minimum={-20000}
              maximum={20000}
              onValue={(x) => {
                change({ ...element, position: { ...element.position, x } }, 'x');
              }}
            />
          )}
        </Field>
        <Field label="Y">
          {(ids) => (
            <NumberInput
              {...ids}
              value={element.position.y}
              disabled={locked}
              minimum={-20000}
              maximum={20000}
              onValue={(y) => {
                change({ ...element, position: { ...element.position, y } }, 'y');
              }}
            />
          )}
        </Field>
      </Row>
      <Row>
        <Field label="Width">
          {(ids) => (
            <NumberInput
              {...ids}
              value={element.size.width}
              disabled={locked}
              minimum={1}
              maximum={20000}
              onValue={(width) => {
                change({ ...element, size: { ...element.size, width } }, 'width');
              }}
            />
          )}
        </Field>
        <Field label="Height">
          {(ids) => (
            <NumberInput
              {...ids}
              value={element.size.height}
              disabled={locked}
              minimum={1}
              maximum={20000}
              onValue={(height) => {
                change({ ...element, size: { ...element.size, height } }, 'height');
              }}
            />
          )}
        </Field>
      </Row>
      <Row>
        <Field label="Rotation in degrees">
          {(ids) => (
            <NumberInput
              {...ids}
              value={element.rotation}
              disabled={locked}
              minimum={-3600}
              maximum={3600}
              onValue={(rotation) => {
                change({ ...element, rotation }, 'rotation');
              }}
            />
          )}
        </Field>
        <Field label="Opacity in percent">
          {(ids) => (
            <NumberInput
              {...ids}
              value={element.opacity * 100}
              disabled={locked}
              minimum={0}
              maximum={100}
              precision={0}
              onValue={(percent) => {
                change({ ...element, opacity: percent / 100 }, 'opacity');
              }}
            />
          )}
        </Field>
      </Row>
    </Section>
  );
}

export function ElementPanel({
  project,
  koma,
  element,
}: {
  readonly project: KomaProject;
  readonly koma: Koma;
  readonly element: KomaElement;
}): ReactElement {
  const apply = useProjectStore((state) => state.apply);
  const selectElement = useUiStore((state) => state.selectElement);
  const { locked } = element;
  const canvas = getCanvasSize(project.presentation.aspectRatio);
  const state = describeLayerState(element, canvas);
  const ordered = orderLayers(koma.elements);
  const place = ordered.findIndex((item) => item.id === element.id);
  const name = getLayerName(element);

  const change: Change = (next, field) => {
    apply(changeElement(koma.id, next), { coalesceKey: `element:${element.id}:${field}` });
  };
  const restack = (move: StackMove): void => {
    apply(restackElement(koma.id, element.id, move));
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 px-3 pt-2 pb-3">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="flex-none text-pencil-blue">
            <ElementTypeIcon element={element} size={16} />
          </span>
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-ink-100">
            <span className="sr-only">Selected element: </span>
            {name}
          </h2>
          <IconButton
            label="Delete element"
            disabled={locked}
            onClick={() => {
              apply(deleteElement(koma.id, element.id));
              selectElement(null);
            }}
          >
            <TrashIcon />
          </IconButton>
        </div>
        <Field label="Name">
          {(ids) => (
            <TextInput
              {...ids}
              value={element.name}
              maxLength={120}
              disabled={locked}
              onChange={(event) => {
                change({ ...element, name: event.target.value }, 'name');
              }}
            />
          )}
        </Field>
        <div role="toolbar" aria-label="Element state" className="flex items-center gap-0.5">
          <IconButton
            label={element.visible ? 'Hide element' : 'Show element'}
            disabled={locked}
            className={element.visible ? '' : 'text-signal-warn'}
            onClick={() => {
              change({ ...element, visible: !element.visible }, 'visible');
            }}
          >
            {element.visible ? <EyeIcon /> : <EyeOffIcon />}
          </IconButton>
          <IconButton
            label={locked ? 'Unlock element' : 'Lock element'}
            className={locked ? 'text-signal-warn' : ''}
            onClick={() => {
              change({ ...element, locked: !locked }, 'locked');
            }}
          >
            {locked ? <LockIcon /> : <UnlockIcon />}
          </IconButton>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-desk-600" />
          <IconButton
            label="Bring forward"
            disabled={locked || place <= 0}
            onClick={() => {
              restack('forward');
            }}
          >
            <BringForwardIcon />
          </IconButton>
          <IconButton
            label="Send backward"
            disabled={locked || place === -1 || place >= ordered.length - 1}
            onClick={() => {
              restack('backward');
            }}
          >
            <SendBackwardIcon />
          </IconButton>
          <span className="ml-auto text-sm text-ink-400 tabular-nums">
            Layer {place + 1} of {ordered.length}
          </span>
        </div>
        {state.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {state.map((item) => (
              <Chip key={item} tone="warn">
                {item.charAt(0).toUpperCase() + item.slice(1)}
              </Chip>
            ))}
          </div>
        )}
        {!element.visible && (
          <p className="flex gap-2 text-sm text-ink-400">
            <span className="mt-0.5 flex-none text-signal-warn">
              <WarningIcon size={14} />
            </span>
            Hidden elements are not drawn on the canvas, in thumbnails or in previews.
          </p>
        )}
        {locked && (
          <p className="text-sm text-ink-400">Unlock the element to change or delete it.</p>
        )}
      </div>

      {element.type === 'text' && (
        <TextControls element={element} locked={locked} change={change} />
      )}
      {element.type === 'shape' && (
        <ShapeControls
          element={element}
          locked={locked}
          change={change}
          defaults={{
            fill: project.brandKit.colours.primary,
            stroke: project.brandKit.colours.text,
          }}
        />
      )}
      {element.type === 'image' && (
        <ImageControls
          koma={koma}
          element={element}
          project={project}
          locked={locked}
          change={change}
        />
      )}
      {element.type === 'group' && (
        <Section title="Group">
          <p className="text-ink-400">
            This group contains {element.content.children.length} elements. They move and scale with
            the group.
          </p>
        </Section>
      )}

      <GeometryControls element={element} locked={locked} change={change} />

      <Disclosure title="Details" summary={describeElementKind(element)}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-400">Type</dt>
          <dd>{describeElementKind(element)}</dd>
          <dt className="text-ink-400">Persistent identity</dt>
          <dd className="truncate select-text" title={element.persistentId}>
            {element.persistentId}
          </dd>
        </dl>
        <p className="text-sm text-ink-400">
          Objects with the same persistent identity on neighbouring Komas move into one another.
        </p>
        <Field label="Layer number" hint="Higher layers are drawn in front.">
          {(ids) => (
            <NumberInput
              {...ids}
              value={element.zIndex}
              disabled={locked}
              minimum={-10000}
              maximum={10000}
              precision={0}
              onValue={(zIndex) => {
                change({ ...element, zIndex: Math.round(zIndex) }, 'layer');
              }}
            />
          )}
        </Field>
      </Disclosure>
    </div>
  );
}
