import type { Koma } from '@koma-motion/core';
import type { ReactElement } from 'react';
import { addKomaAfter } from '../../lib/projectActions';
import { changeKomaDetails } from '../../state/commands';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { PlusIcon } from '../icons';
import { Badge, Button, Field, TextArea, TextInput } from '../ui';
import type { TransitionHealth } from './MotionPanel';
import { ColourField, Disclosure, Section } from './parts';

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line === '' ? 'None yet' : line;
}

export function KomaPanel({
  koma,
  index,
  count,
  health,
  editable,
}: {
  readonly koma: Koma;
  readonly index: number;
  readonly count: number;
  /** The motion of this Koma, or `null` when there is no transition. */
  readonly health: TransitionHealth | null;
  /** False while a preview plays. */
  readonly editable: boolean;
}): ReactElement {
  const apply = useProjectStore((state) => state.apply);
  const setInspectorTab = useUiStore((state) => state.setInspectorTab);
  const change = (patch: Parameters<typeof changeKomaDetails>[1], field: string): void => {
    apply(changeKomaDetails(koma.id, patch), { coalesceKey: `koma:${koma.id}:${field}` });
  };
  const hidden = koma.elements.filter((element) => !element.visible).length;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 px-3 pt-2 pb-3">
        <div className="flex h-7 items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-ink-100">Koma {index + 1}</h2>
          <span className="text-sm text-ink-400 tabular-nums">of {count}</span>
        </div>
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
        <Field label="Purpose" hint="What this Koma should make the audience understand.">
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
      </div>

      <Section title="Overview">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-ink-400">Elements</dt>
          <dd className="tabular-nums">
            {koma.elements.length}
            {hidden > 0 && `, ${String(hidden)} hidden`}
          </dd>
          <dt className="text-ink-400">Motion</dt>
          <dd className="flex min-w-0 items-center justify-between gap-2">
            {health === null ? (
              <span className="text-ink-400">None: this is the only Koma</span>
            ) : (
              <>
                <Badge tone={health.status.health === 'ready' ? 'ok' : 'warn'}>
                  {health.status.title}
                </Badge>
                <Button
                  compact
                  onClick={() => {
                    setInspectorTab('motion');
                  }}
                >
                  Open motion
                </Button>
              </>
            )}
          </dd>
        </dl>
        <div className="flex flex-wrap gap-1">
          <Button
            variant="outline"
            compact
            icon={<PlusIcon size={14} />}
            disabled={!editable}
            onClick={() => {
              addKomaAfter(koma.id);
            }}
          >
            New Koma after this one
          </Button>
        </div>
      </Section>

      <Disclosure title="Background" summary={koma.background.colour}>
        <ColourField
          label="Background"
          value={koma.background.colour}
          onValue={(colour) => {
            change({ background: { type: 'solid', colour } }, 'background');
          }}
        />
      </Disclosure>

      <Disclosure
        title="Speaker notes"
        summary={firstLine(koma.speakerNotes)}
        defaultOpen={koma.speakerNotes.trim() !== ''}
      >
        <Field label="Speaker notes">
          {(ids) => (
            <TextArea
              {...ids}
              rows={4}
              value={koma.speakerNotes}
              maxLength={20000}
              onChange={(event) => {
                change({ speakerNotes: event.target.value }, 'notes');
              }}
            />
          )}
        </Field>
      </Disclosure>
    </div>
  );
}
