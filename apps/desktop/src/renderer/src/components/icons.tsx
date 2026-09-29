import type { ReactElement, ReactNode } from 'react';

interface IconProps {
  readonly size?: number;
}

function Icon({ size = 16, children }: IconProps & { readonly children: ReactNode }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const PlayIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M5 3.5v9l7-4.5z" fill="currentColor" />
  </Icon>
);

export const PauseIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth="2" />
  </Icon>
);

export const RestartIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M3 8a5 5 0 1 0 1.6-3.7" />
    <path d="M3 2.5v3h3" />
  </Icon>
);

export const PreviousIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M11.5 3.5 6 8l5.5 4.5z" fill="currentColor" />
    <path d="M4 3.5v9" />
  </Icon>
);

export const NextIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M4.5 3.5 10 8l-5.5 4.5z" fill="currentColor" />
    <path d="M12 3.5v9" />
  </Icon>
);

export const PlusIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

export const TrashIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M3 4.5h10M6.5 4.5v-2h3v2M4.5 4.5l.5 9h6l.5-9" />
  </Icon>
);

export const UpIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Icon>
);

export const DownIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M8 3v10M4 9l4 4 4-4" />
  </Icon>
);

export const SettingsIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
    <circle cx="10" cy="4.5" r="1.5" />
    <circle cx="6" cy="11.5" r="1.5" />
  </Icon>
);

export const CloseIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
);

export const WarningIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M8 2.5 14 13H2z" />
    <path d="M8 6.5v3M8 11.2v.1" />
  </Icon>
);

export const CheckIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="m3.5 8.5 3 3 6-7" />
  </Icon>
);

export const UndoIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M5.5 3 2.5 6l3 3" />
    <path d="M2.5 6h7a4 4 0 0 1 0 8H6" />
  </Icon>
);

export const RedoIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="m10.5 3 3 3-3 3" />
    <path d="M13.5 6h-7a4 4 0 0 0 0 8H10" />
  </Icon>
);

export const RefreshIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M13 8a5 5 0 1 1-1.6-3.7" />
    <path d="M13 2.5v3h-3" />
  </Icon>
);

export const DownloadIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10" />
  </Icon>
);

export const ChevronIcon = ({
  size,
  direction,
}: IconProps & { readonly direction: 'up' | 'down' }): ReactElement => (
  <Icon {...(size === undefined ? {} : { size })}>
    <path d={direction === 'down' ? 'm4 6 4 4 4-4' : 'm4 10 4-4 4 4'} />
  </Icon>
);

/**
 * The application mark: two frames, offset like a drawing and its onion skin.
 * Blue is the frame before, red the frame in motion.
 */
export function KomaMark({ size = 22 }: IconProps): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true" focusable="false">
      <rect
        x="2"
        y="2"
        width="13"
        height="13"
        rx="2.5"
        fill="none"
        stroke="var(--color-pencil-blue)"
        strokeWidth="1.75"
      />
      <rect x="7" y="7" width="13" height="13" rx="2.5" fill="var(--color-pencil-red)" />
    </svg>
  );
}
