import { useId, type ReactElement, type ReactNode } from 'react';

/**
 * One setting: its name and an explanation on the left, the control on the
 * right. `children` receives the ids that connect the control with the text.
 */
export function SettingRow({
  label,
  description,
  children,
}: {
  readonly label: string;
  readonly description?: ReactNode;
  readonly children: (ids: { id: string; 'aria-describedby': string | undefined }) => ReactNode;
}): ReactElement {
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <div className="flex min-w-0 items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="block font-medium text-ink-100">
          {label}
        </label>
        {description !== undefined && (
          <p id={descriptionId} className="mt-0.5 text-sm leading-relaxed text-ink-400">
            {description}
          </p>
        )}
      </div>
      <div className="flex flex-none items-center">
        {children({
          id,
          'aria-describedby': description === undefined ? undefined : descriptionId,
        })}
      </div>
    </div>
  );
}

/** A titled group of settings on a card. */
export function SettingsCard({
  title,
  description,
  action,
  children,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="min-w-0 rounded-card border border-line bg-surface-1/70 px-4 pt-3.5 pb-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 id={id} className="font-semibold text-ink-100">
            {title}
          </h4>
          {description !== undefined && (
            <p className="mt-0.5 text-sm leading-relaxed text-ink-400">{description}</p>
          )}
        </div>
        {action}
      </div>
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  );
}
