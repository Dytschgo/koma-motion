/** Layout pieces shared by the contexts of the Inspector. They contain no application logic. */
import { parseColour } from '@koma-motion/core';
import { useId, useState, type ReactElement, type ReactNode } from 'react';
import { ChevronIcon } from '../icons';
import { Field, TextInput } from '../ui';

export function Section({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className="border-t border-line px-3 pt-2 pb-3 first:border-t-0">
      <div className="flex min-h-7 items-center justify-between gap-2 pb-1">
        <h3 className="text-sm font-semibold tracking-wide text-ink-300 uppercase">{title}</h3>
        {action}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function Row({ children }: { readonly children: ReactNode }): ReactElement {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

/**
 * A section that can be folded away. Used for settings that are needed less
 * often, so that they do not push the frequent ones out of view.
 */
export function Disclosure({
  title,
  icon,
  summary,
  defaultOpen = false,
  children,
}: {
  readonly title: string;
  readonly icon?: ReactNode;
  /** Shown beside the title while the section is folded. */
  readonly summary?: string | undefined;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="border-t border-line px-3 py-1 first:border-t-0">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          className="-mx-1 flex h-8 w-[calc(100%+0.5rem)] items-center gap-1.5 rounded-md px-1 text-left text-sm font-semibold tracking-wide text-ink-300 uppercase hover:bg-surface-3 hover:text-ink-100"
          onClick={() => {
            setOpen(!open);
          }}
        >
          <ChevronIcon size={14} direction={open ? 'down' : 'right'} />
          {icon}
          <span className="flex-none">{title}</span>
          {!open && summary !== undefined && summary !== '' && (
            <span className="min-w-0 truncate font-normal tracking-normal text-ink-400 normal-case">
              {summary}
            </span>
          )}
        </button>
      </h3>
      <div id={id} hidden={!open} className="flex flex-col gap-3 pt-1 pb-2">
        {open && children}
      </div>
    </section>
  );
}

const CHIP_TONES = {
  neutral: 'border-line-strong text-ink-300',
  warn: 'border-signal-warn/50 text-signal-warn',
  ok: 'border-signal-ok/50 text-signal-ok',
} as const;

export function Chip({
  tone = 'neutral',
  children,
}: {
  readonly tone?: keyof typeof CHIP_TONES;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full border px-2 text-xs whitespace-nowrap ${CHIP_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** A colour field that only reports valid colours, in the stored format. */
export function ColourField({
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
            className="size-8 flex-none rounded-md border border-line-strong"
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
