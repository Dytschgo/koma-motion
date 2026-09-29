import {
  collectProjectWarnings,
  EASINGS,
  parseColour,
  SHAPE_KINDS,
  TEXT_ALIGNMENTS,
  TRANSITION_STRATEGIES,
  VERTICAL_ALIGNMENTS,
  type Koma,
  type KomaElement,
  type KomaProject,
  type KomaTransition,
} from '@koma-motion/core';
import { validateTransition } from '@koma-motion/motion-engine';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import {
  getTransitionContext,
  useCurrentTransition,
  useSelectedElement,
  useSelectedKoma,
} from '../lib/selectors';
import {
  changeElement,
  changeKomaDetails,
  changeTransition,
  deleteElement,
} from '../state/commands';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { TrashIcon, WarningIcon } from './icons';
import { Field, IconButton, NumberInput, PanelHeading, Select, TextArea, TextInput } from './ui';

function Section({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className="border-b border-desk-600 px-3 pt-1 pb-4">
      <PanelHeading action={action}>{title}</PanelHeading>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Row({ children }: { readonly children: ReactNode }): ReactElement {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

/** A colour field that only reports valid colours, in the stored format. */
function ColourField({
  label,
  value,
  disabled = false,
  onValue,
}: {
  readonly label: string;
  readonly value: string;
  readonly disabled?: boolean;
  readonly onValue: (colour: string) => void;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;
  const parsed = parseColour(text);
  return (
    <Field label={label} error={parsed.ok ? undefined : 'Use a hex colour such as #7CC4E8.'}>
      {(ids) => (
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-8 flex-none rounded-md border border-desk-500"
            style={{ background: parsed.ok ? parsed.value : 'transparent' }}
          />
          <TextInput
            {...ids}
            value={text}
            disabled={disabled}
            spellCheck={false}
            onChange={(event) => {
              setDraft(event.target.value);
              const next = parseColour(event.target.value);
              if (next.ok) {
                onValue(next.value);
              }
            }}
            onBlur={() => {
              setDraft(null);
            }}
          />
        </div>
      )}
    </Field>
  );
}

function KomaSection({
  koma,
  index,
}: {
  readonly koma: Koma;
  readonly index: number;
}): ReactElement {
  const apply = useProjectStore((state) => state.apply);
  const change = (patch: Parameters<typeof changeKomaDetails>[1], field: string): void => {
    apply(changeKomaDetails(koma.id, patch), { coalesceKey: `koma:${koma.id}:${field}` });
  };
  return (
    <Section title={`Koma ${String(index + 1)}`}>
      <Field label="Title">
        {(ids) => (
          <TextInput
            {...ids}
            value={koma.title}
            maxLength={300}
            onChange={(event) => {
              change({ title: event.target.value }, 'title');
            }}
          />
        )}
      </Field>
      <Field label="Purpose">
        {(ids) => (
          <TextArea
            {...ids}
            rows={2}
            value={koma.purpose}
            maxLength={2000}
            onChange={(event) => {
              change({ purpose: event.target.value }, 'purpose');
            }}
          />
        )}
      </Field>
      <Field label="Speaker notes">
        {(ids) => (
          <TextArea
            {...ids}
            rows={3}
            value={koma.speakerNotes}
            maxLength={20000}
            onChange={(event) => {
              change({ speakerNotes: event.target.value }, 'notes');
            }}
          />
        )}
      </Field>
      <ColourField
        label="Background"
        value={koma.background.colour}
        onValue={(colour) => {
          change({ background: { type: 'solid', colour } }, 'background');
        }}
      />
    </Section>
  );
}

function ElementList({ koma }: { readonly koma: Koma }): ReactElement {
  const selectedElementId = useUiStore((state) => state.selectedElementId);
  const selectElement = useUiStore((state) => state.selectElement);
  const ordered = useMemo(
    () => [...koma.elements].sort((a, b) => b.zIndex - a.zIndex),
    [koma.elements],
  );
  return (
    <Section title="Elements">
      {ordered.length === 0 ? (
        <p className="text-ink-400">This Koma has no elements.</p>
      ) : (
        <ul className="-mx-1 flex max-h-48 flex-col overflow-y-auto">
          {ordered.map((element) => {
            const selected = element.id === selectedElementId;
            return (
              <li key={element.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left ${
                    selected ? 'bg-pencil-blue-deep text-ink-100' : 'text-ink-300 hover:bg-desk-700'
                  }`}
                  onClick={() => {
                    selectElement(selected ? null : element.id);
                  }}
                >
                  <span className="truncate">{element.name}</span>
                  <span className="flex-none text-sm text-ink-400">
                    {element.type}
                    {!element.visible && ', hidden'}
                    {element.locked && ', locked'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function ElementSection({
  koma,
  element,
}: {
  readonly koma: Koma;
  readonly element: KomaElement;
}): ReactElement {
  const apply = useProjectStore((state) => state.apply);
  const selectElement = useUiStore((state) => state.selectElement);
  const { locked } = element;

  const change = (next: KomaElement, field: string): void => {
    apply(changeElement(koma.id, next), { coalesceKey: `element:${element.id}:${field}` });
  };

  return (
    <Section
      title="Selected element"
      action={
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
      }
    >
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

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-400">Type</dt>
        <dd>{element.type}</dd>
        <dt className="text-ink-400">Persistent identity</dt>
        <dd className="truncate select-text" title={element.persistentId}>
          {element.persistentId}
        </dd>
      </dl>

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
      <Field label="Layer" hint="Higher layers are drawn in front.">
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

      {element.type === 'text' && (
        <>
          <Field label="Text">
            {(ids) => (
              <TextArea
                {...ids}
                rows={3}
                value={element.content.text}
                maxLength={5000}
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
          <Field label="Font family">
            {(ids) => <TextInput {...ids} value={element.style.fontFamily} readOnly />}
          </Field>
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
          <ColourField
            label="Text colour"
            value={element.style.colour}
            disabled={locked}
            onValue={(colour) => {
              change({ ...element, style: { ...element.style, colour } }, 'colour');
            }}
          />
        </>
      )}

      {element.type === 'shape' && (
        <>
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
          {element.style.stroke !== null && (
            <>
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
                      change(
                        { ...element, style: { ...element.style, strokeWidth } },
                        'stroke-width',
                      );
                    }}
                  />
                )}
              </Field>
            </>
          )}
        </>
      )}

      {element.type === 'image' && (
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
      )}

      {element.type === 'group' && (
        <p className="text-ink-400">
          This group contains {element.content.children.length} elements. They move and scale with
          the group.
        </p>
      )}

      <div className="flex gap-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-pencil-blue"
            checked={element.visible}
            disabled={locked}
            onChange={(event) => {
              change({ ...element, visible: event.target.checked }, 'visible');
            }}
          />
          Visible
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-pencil-blue"
            checked={locked}
            onChange={(event) => {
              change({ ...element, locked: event.target.checked }, 'locked');
            }}
          />
          Locked
        </label>
      </div>
    </Section>
  );
}

const OPERATION_LABELS: Readonly<Record<string, string>> = {
  hold: 'holds',
  move: 'moves',
  scale: 'changes size',
  rotate: 'rotates',
  fadeIn: 'fades in',
  fadeOut: 'fades out',
  colourChange: 'changes colour',
  replace: 'is replaced',
};

function describeOperations(transition: KomaTransition, to: Koma, from: Koma): string[][] {
  const names = new Map<string, string>();
  for (const element of [...from.elements, ...to.elements]) {
    names.set(element.persistentId, element.name);
  }
  const grouped = new Map<string, string[]>();
  for (const item of transition.elementTransitions) {
    const role =
      item.from === null ? 'enters' : item.to === null ? 'exits' : OPERATION_LABELS[item.operation];
    const operations = grouped.get(item.persistentId) ?? [];
    operations.push(role ?? item.operation);
    grouped.set(item.persistentId, operations);
  }
  return [...grouped.entries()].map(([persistentId, operations]) => [
    names.get(persistentId) ?? persistentId,
    operations.join(', '),
  ]);
}

function TransitionSection({
  project,
  transition,
}: {
  readonly project: KomaProject;
  readonly transition: KomaTransition;
}): ReactElement | null {
  const apply = useProjectStore((state) => state.apply);
  const context = getTransitionContext(project.presentation, transition.id);
  const issues = useMemo(
    () => validateTransition(transition, project.presentation),
    [transition, project.presentation],
  );
  if (context === null) {
    return null;
  }
  const change = (patch: Parameters<typeof changeTransition>[1], field: string): void => {
    apply(changeTransition(transition.id, patch), {
      coalesceKey: `transition:${transition.id}:${field}`,
    });
  };
  const operations = describeOperations(transition, context.to, context.from);

  return (
    <Section
      title={`Transition ${String(context.fromIndex + 1)} to ${String(context.fromIndex + 2)}`}
    >
      <Field label="Why this motion">
        {(ids) => (
          <TextArea
            {...ids}
            rows={4}
            value={transition.rationale}
            maxLength={1000}
            onChange={(event) => {
              change({ rationale: event.target.value }, 'rationale');
            }}
          />
        )}
      </Field>
      <Row>
        <Field label="Strategy">
          {(ids) => (
            <Select
              {...ids}
              value={transition.strategy}
              onChange={(event) => {
                const strategy = TRANSITION_STRATEGIES.find((item) => item === event.target.value);
                if (strategy !== undefined) {
                  change({ strategy }, 'strategy');
                }
              }}
            >
              <option value="continuous">Continuous</option>
              <option value="staged">Staged</option>
            </Select>
          )}
        </Field>
        <Field label="Easing">
          {(ids) => (
            <Select
              {...ids}
              value={transition.easing}
              onChange={(event) => {
                const easing = EASINGS.find((item) => item === event.target.value);
                if (easing !== undefined) {
                  change({ easing }, 'easing');
                }
              }}
            >
              <option value="linear">Linear</option>
              <option value="easeIn">Ease in</option>
              <option value="easeOut">Ease out</option>
              <option value="easeInOut">Ease in and out</option>
            </Select>
          )}
        </Field>
      </Row>
      <p className="text-sm text-ink-400">
        {transition.strategy === 'staged'
          ? 'Staged: objects leave first, then retained objects change, then new objects enter.'
          : 'Continuous: every object changes across the whole duration.'}
      </p>

      <div>
        <h3 className="mb-1 text-sm text-ink-300">What happens to each object</h3>
        <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto text-sm">
          {operations.map(([name, description]) => (
            <li key={name} className="flex justify-between gap-3">
              <span className="truncate text-ink-100">{name}</span>
              <span className="flex-none text-ink-400">{description}</span>
            </li>
          ))}
        </ul>
      </div>

      {issues.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 text-sm text-signal-warn">
          {issues.map((issue, index) => (
            <li key={index} className="flex gap-2">
              <span className="flex-none">
                <WarningIcon size={14} />
              </span>
              Warning: {issue.message}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function WarningsSection({ project }: { readonly project: KomaProject }): ReactElement | null {
  const loadWarnings = useProjectStore((state) => state.loadWarnings);
  const warnings = useMemo(() => {
    const current = collectProjectWarnings(project).map((warning) => warning.message);
    return [
      ...new Set([...current, ...loadWarnings.filter((warning) => !current.includes(warning))]),
    ];
  }, [project, loadWarnings]);
  if (warnings.length === 0) {
    return null;
  }
  return (
    <Section title={`Warnings (${String(warnings.length)})`}>
      <ul className="flex flex-col gap-2 text-sm text-signal-warn">
        {warnings.map((warning) => (
          <li key={warning} className="flex gap-2">
            <span className="flex-none">
              <WarningIcon size={14} />
            </span>
            {warning}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function Inspector({ project }: { readonly project: KomaProject }): ReactElement {
  const koma = useSelectedKoma();
  const element = useSelectedElement();
  const transition = useCurrentTransition();
  const index = project.presentation.komas.findIndex((candidate) => candidate.id === koma?.id);

  return (
    <aside
      aria-label="Inspector"
      className="w-[304px] flex-none overflow-y-auto border-l border-desk-600 bg-desk-800"
    >
      <WarningsSection project={project} />
      {koma === null ? (
        <p className="p-4 text-ink-400">Select a Koma to see its details.</p>
      ) : (
        <>
          {element !== null && <ElementSection key={element.id} koma={koma} element={element} />}
          <ElementList koma={koma} />
          <KomaSection key={koma.id} koma={koma} index={index} />
        </>
      )}
      {transition !== null && (
        <TransitionSection key={transition.id} project={project} transition={transition} />
      )}
    </aside>
  );
}
