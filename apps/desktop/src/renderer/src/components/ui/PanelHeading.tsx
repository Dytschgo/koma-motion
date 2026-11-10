import type { ReactElement, ReactNode } from 'react';

export function PanelHeading({
  children,
  action,
}: {
  readonly children: ReactNode;
  readonly action?: ReactNode;
}): ReactElement {
  return (
    <div className="flex h-9 items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-ink-100">{children}</h2>
      {action}
    </div>
  );
}
