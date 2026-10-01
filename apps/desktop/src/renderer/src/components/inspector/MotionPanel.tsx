import {
  EASINGS,
  MAX_TRANSITION_DURATION_MS,
  MIN_TRANSITION_DURATION_MS,
  TRANSITION_STRATEGIES,
  type Koma,
  type KomaProject,
  type KomaTransition,
} from '@koma-motion/core';
import type { MotionIssue } from '@koma-motion/motion-engine';
import { useMemo, useState, type ReactElement } from 'react';
import {
  filterEffects,
  summariseMotion,
  type EffectKind,
  type MotionStatus,
} from '../../lib/motionSummary';
import { addKomaAfter } from '../../lib/projectActions';
import { getTransitionContext } from '../../lib/selectors';
import { changeTransition, recalculateTransition } from '../../state/commands';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { CheckIcon, PlayIcon, RefreshIcon, WarningIcon } from '../icons';
import { Button, Field, NumberInput, Select, TextArea, TextInput } from '../ui';
import { Chip, Disclosure, Row, Section } from './parts';

/** Effects listed before the rest is folded away. */
const EFFECTS_SHOWN = 8;

const KIND_LABELS: Readonly<Record<EffectKind, string>> = {
  changes: 'changing',
  enters: 'entering',
  exits: 'exiting',
  holds: 'holding',
};

export interface TransitionHealth {
  readonly issues: readonly MotionIssue[];
  readonly status: MotionStatus;
  /** Whether recalculating the motion would change and repair it. */
  readonly canRecalculate: boolean;
}

export function MotionStatusBanner({
  health,
  onRecalculate,
}: {
  readonly health: TransitionHealth;
  readonly onRecalculate: () => void;
}): ReactElement {
  const { status } = health;
  const ready = status.health === 'ready';
  return (
    <div
      role="status"
      aria-label="Motion status"
      className={`flex flex-col gap-2 rounded-lg border px-3 py-2 ${
        ready ? 'border-signal-ok/40' : 'border-signal-warn/50 bg-surface-1'
      }`}
    >
      <p
        className={`flex items-center gap-2 font-semibold ${ready ? 'text-signal-ok' : 'text-signal-warn'}`}
      >
        <span className="flex-none">
          {ready ? <CheckIcon size={14} /> : <WarningIcon size={14} />}
        </span>
        {status.title}
      </p>
      {!ready && <p className="text-sm text-ink-300">{status.detail}</p>}
      {health.canRecalculate && (
        <Button
          variant="primary"
          icon={<RefreshIcon size={14} />}
          className="self-start"
          onClick={onRecalculate}
        >
          Recalculate motion
        </Button>
      )}
      {!ready && !health.canRecalculate && status.health !== 'partial' && (
        <p className="text-sm text-ink-400">Check the Komas for errors, or undo the last edit.</p>
      )}
    </div>
  );
}

function EffectList({
  transition,
  from,
  to,
  stale,
}: {
  readonly transition: KomaTransition;
  readonly from: Koma;
  readonly to: Koma;
  readonly stale: boolean;
}): ReactElement {
  const summary = useMemo(() => summariseMotion(transition, from, to), [transition, from, to]);
  const [query, setQuery] = useState('');
  const [showHolds, setShowHolds] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { effects, counts } = summary;
  const searching = query.trim() !== '';
  const relevant = filterEffects(
    searching || showHolds ? effects : effects.filter((effect) => effect.kind !== 'holds'),
    query,
  );
  const shown = expanded || searching ? relevant : relevant.slice(0, EFFECTS_SHOWN);
  const chips = (Object.keys(KIND_LABELS) as EffectKind[]).filter((kind) => counts[kind] > 0);

  return (
    <Section title={stale ? 'Stored effects (out of date)' : 'Effects'}>
      {effects.length === 0 ? (
        <p className="text-ink-400">No objects take part in this transition.</p>
      ) : (
        <>
          <p className="flex flex-wrap gap-1" aria-label="Effect summary">
            {chips.map((kind) => (
              <Chip key={kind}>
                {counts[kind]} {KIND_LABELS[kind]}
              </Chip>
            ))}
          </p>
          {effects.length > EFFECTS_SHOWN && (
            <TextInput
              type="search"
              aria-label="Filter effects"
              placeholder="Filter effects by object"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          )}
          {relevant.length === 0 ? (
            <p className="text-sm text-ink-400">
              {searching ? 'No effects match the filter.' : 'Every object holds its place.'}
            </p>
          ) : (
            <ul
              aria-label="What happens to each object"
              className={`flex flex-col gap-0.5 text-sm ${stale ? 'opacity-70' : ''}`}
            >
              {shown.map((effect) => (
                <li key={effect.persistentId} className="flex justify-between gap-3">
                  <span className="truncate text-ink-100">{effect.name}</span>
                  <span className="flex-none text-ink-400">{effect.description}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-1">
            {!searching && relevant.length > EFFECTS_SHOWN && (
              <Button
                compact
                aria-expanded={expanded}
                onClick={() => {
                  setExpanded(!expanded);
                }}
              >
                {expanded ? 'Show fewer' : `Show all ${String(relevant.length)}`}
              </Button>
            )}
            {!searching && counts.holds > 0 && (
              <Button
                compact
                aria-pressed={showHolds}
                onClick={() => {
                  setShowHolds(!showHolds);
                }}
              >
                {showHolds
                  ? 'Hide objects that hold'
                  : `Show ${String(counts.holds)} ${counts.holds === 1 ? 'object that holds' : 'objects that hold'}`}
              </Button>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

export function MotionPanel({
  project,
  transition,
  health,
  komaId,
}: {
  readonly project: KomaProject;
  readonly transition: KomaTransition | null;
  readonly health: TransitionHealth | null;
  readonly komaId: string | null;
}): ReactElement {
  const apply = useProjectStore((state) => state.apply);
  const preview = useUiStore((state) => state.preview);
  const startPreview = useUiStore((state) => state.startPreview);
  const context =
    transition === null ? null : getTransitionContext(project.presentation, transition.id);

  if (transition === null || context === null || health === null) {
    const stalePreview = preview !== null;
    return (
      <div className="flex flex-col gap-3 px-3 py-3">
        <h2 className="text-base font-semibold text-ink-100">Motion</h2>
        <p className="text-ink-400">
          {stalePreview
            ? 'The previewed transition no longer exists. Stop the preview to see the motion of the selected Koma.'
            : 'Motion runs between two Komas. Add a Koma to see how its objects move.'}
        </p>
        {!stalePreview && (
          <Button
            variant="outline"
            className="self-start"
            onClick={() => {
              addKomaAfter(komaId);
            }}
          >
            New Koma after this one
          </Button>
        )}
      </div>
    );
  }

  const change = (patch: Parameters<typeof changeTransition>[1], field: string): void => {
    apply(changeTransition(transition.id, patch), {
      coalesceKey: `transition:${transition.id}:${field}`,
    });
  };
  const ready = health.status.health === 'ready' || health.status.health === 'partial';
  const technical = health.issues.filter((issue) => issue.code !== 'staleTransition');

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 px-3 pt-2 pb-3">
        <h2 className="text-base font-semibold text-ink-100">
          Transition {context.fromIndex + 1} to {context.fromIndex + 2}
        </h2>
        <p className="flex min-w-0 items-center gap-1.5 text-sm text-ink-400">
          <span className="truncate">{context.from.title}</span>
          <span aria-label="to" className="flex-none">
            →
          </span>
          <span className="truncate">{context.to.title}</span>
        </p>
        <MotionStatusBanner
          health={health}
          onRecalculate={() => {
            apply(recalculateTransition(transition.id));
          }}
        />
        {ready && (
          <Button
            variant="outline"
            icon={<PlayIcon size={14} />}
            className="self-start"
            onClick={() => {
              startPreview(transition.id);
            }}
          >
            Preview this transition
          </Button>
        )}
      </div>

      <Section title="Timing">
        <Row>
          <Field label="Duration in seconds">
            {(ids) => (
              <NumberInput
                {...ids}
                value={transition.duration / 1000}
                minimum={MIN_TRANSITION_DURATION_MS / 1000}
                maximum={MAX_TRANSITION_DURATION_MS / 1000}
                onValue={(seconds) => {
                  // Shares its history step with the duration of the transport.
                  apply(changeTransition(transition.id, { duration: seconds * 1000 }), {
                    coalesceKey: `transition-duration:${transition.id}`,
                  });
                }}
              />
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
                <option value="easeInOut">Ease in-out</option>
              </Select>
            )}
          </Field>
        </Row>
        <Field
          label="Strategy"
          hint={
            transition.strategy === 'staged'
              ? 'Objects leave first, then retained objects change, then new objects enter.'
              : 'Every object changes across the whole duration.'
          }
        >
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
      </Section>

      <Section title="Intent">
        <Field label="Why this motion">
          {(ids) => (
            <TextArea
              {...ids}
              rows={3}
              value={transition.rationale}
              maxLength={1000}
              onChange={(event) => {
                change({ rationale: event.target.value }, 'rationale');
              }}
            />
          )}
        </Field>
      </Section>

      <EffectList
        key={transition.id}
        transition={transition}
        from={context.from}
        to={context.to}
        stale={!ready}
      />

      {technical.length > 0 && (
        <Disclosure
          title="Problems"
          summary={`${String(technical.length)} found`}
          defaultOpen={health.status.health === 'blocked'}
        >
          <ul className="flex flex-col gap-1 text-sm text-signal-warn">
            {technical.map((issue, index) => (
              <li key={index} className="flex gap-2">
                <span className="mt-0.5 flex-none">
                  <WarningIcon size={14} />
                </span>
                Warning: {issue.message}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}
