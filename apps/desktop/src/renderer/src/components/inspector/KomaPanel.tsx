import { MIN_KOMA_HOLD_DURATION_MS, MAX_KOMA_HOLD_DURATION_MS, type Koma } from '@koma-motion/core';
import type { ReactElement } from 'react';
import { changeKomaDetails } from '../../state/commands';
import { usePresenterStore } from '../../state/presenterStore';
import { useProjectStore } from '../../state/projectStore';
import { Field, NumberInput, Switch, TextArea, TextInput } from '../ui';
import { ColourField, Section } from './parts';

export function KomaPanel({
  koma,
  index,
  count,
  editable,
}: {
  readonly koma: Koma;
  readonly index: number;
  readonly count: number;
  /** False while a preview plays. */
  readonly editable: boolean;
}): ReactElement {
  const fallbackHoldMs = usePresenterStore((state) => state.autoplayDelayMs);
  const apply = useProjectStore((state) => state.apply);
  const change = (patch: Parameters<typeof changeKomaDetails>[1], field: string): void => {
    apply(changeKomaDetails(koma.id, patch), { coalesceKey: `koma:${koma.id}:${field}` });
  };

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

      <Section title="Presentation timing">
        <label className="flex items-center justify-between gap-2 text-sm">
          Use global hold duration
          <Switch
            checked={koma.holdDurationMs === null}
            disabled={!editable}
            onCheckedChange={(useGlobal) =>
              change({ holdDurationMs: useGlobal ? null : fallbackHoldMs }, 'hold-duration')
            }
          />
        </label>
        <Field
          label="Koma hold duration in seconds"
          hint="Wait before the next transition. Saved with this Koma; used for autoplay and timed PowerPoint export."
        >
          {(ids) => (
            <NumberInput
              {...ids}
              value={(koma.holdDurationMs ?? fallbackHoldMs) / 1000}
              minimum={MIN_KOMA_HOLD_DURATION_MS / 1000}
              maximum={MAX_KOMA_HOLD_DURATION_MS / 1000}
              precision={3}
              disabled={!editable || koma.holdDurationMs === null}
              onValue={(seconds) =>
                change({ holdDurationMs: Math.round(seconds * 1000) }, 'hold-duration')
              }
            />
          )}
        </Field>
      </Section>

      <Section title="Background">
        <ColourField
          label="Background"
          value={koma.background.colour}
          onValue={(colour) => {
            change({ background: { type: 'solid', colour } }, 'background');
          }}
        />
      </Section>

      <Section title="Speaker notes">
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
      </Section>
    </div>
  );
}
