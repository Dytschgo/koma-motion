import { STARTER_PRESETS, type StarterPreset } from '@koma-motion/brand-kit';
import { useId, type ReactElement } from 'react';

/** A small scene in the starter's own colours, so each card previews its Brand Kit. */
function StarterArt({ preset }: { readonly preset: StarterPreset }): ReactElement {
  const { primary, secondary, accent, background, text } = preset.brandKit.colours;
  return (
    <svg
      viewBox="0 0 160 90"
      className="block h-auto w-full"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="160" height="90" fill={background} />
      {preset.id === 'solar-system' && (
        <>
          {[
            [12, 14],
            [40, 70],
            [70, 20],
            [104, 76],
            [132, 12],
            [150, 52],
          ].map(([x, y]) => (
            <circle key={`${String(x)}-${String(y)}`} cx={x} cy={y} r="0.9" fill={text} />
          ))}
          <circle cx="8" cy="45" r="26" fill={primary} opacity="0.25" />
          <circle cx="8" cy="45" r="18" fill={primary} />
          <circle cx="8" cy="45" r="52" fill="none" stroke={secondary} opacity="0.6" />
          <circle cx="8" cy="45" r="84" fill="none" stroke={secondary} opacity="0.4" />
          <circle cx="58" cy="30" r="5" fill="#3B82F6" />
          <circle cx="90" cy="56" r="11" fill="#D9A066" />
          <rect x="76" y="54" width="28" height="3" rx="1.5" fill="#E9D29A" opacity="0.8" />
          <circle cx="136" cy="40" r="7" fill={accent} />
        </>
      )}
      {preset.id === 'finance-report' && (
        <>
          {[22, 40, 58].map((y) => (
            <rect key={y} x="18" y={y} width="124" height="0.6" fill={text} opacity="0.15" />
          ))}
          {[18, 26, 34, 44, 56].map((height, index) => (
            <rect
              key={index}
              x={24 + index * 24}
              y={72 - height}
              width="14"
              height={height}
              rx="2"
              fill={index === 4 ? accent : primary}
            />
          ))}
          <rect x="18" y="72" width="124" height="1" fill={text} opacity="0.5" />
          <rect x="18" y="8" width="38" height="8" rx="4" fill={secondary} opacity="0.7" />
        </>
      )}
      {preset.id === 'rapunzel' && (
        <>
          <circle cx="132" cy="18" r="9" fill="#FFF3C4" />
          <circle cx="132" cy="18" r="14" fill="#FFF3C4" opacity="0.2" />
          <circle cx="30" cy="120" r="54" fill="#24533D" />
          <circle cx="132" cy="118" r="48" fill="#2F6B4F" />
          <rect x="68" y="22" width="22" height="68" rx="4" fill="#8A7FA8" />
          <rect x="72" y="14" width="14" height="14" fill="#5E537D" transform="rotate(45 79 21)" />
          <rect x="75" y="32" width="8" height="9" rx="4" fill={primary} />
          <rect x="77.5" y="40" width="3" height="46" rx="1.5" fill={primary} />
          {[
            [20, 30],
            [46, 18],
            [110, 44],
          ].map(([x, y]) => (
            <rect
              key={`${String(x)}-${String(y)}`}
              x={x}
              y={y}
              width="5"
              height="7"
              rx="2"
              fill={accent}
            />
          ))}
        </>
      )}
    </svg>
  );
}

/**
 * The three starters. Each one brings a Brand Kit and project instructions
 * and puts a first request into the chat.
 */
export function StarterList({
  actionLabel,
  disabled = false,
  onChoose,
}: {
  /** The verb on each card, for example "Start" or "Apply". */
  readonly actionLabel: string;
  readonly disabled?: boolean;
  readonly onChoose: (preset: StarterPreset) => void;
}): ReactElement {
  const id = useId();
  return (
    <ul aria-label="Starters" className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
      {STARTER_PRESETS.map((preset) => (
        <li key={preset.id} className="min-w-0">
          <button
            type="button"
            disabled={disabled}
            aria-label={`${actionLabel} ${preset.name}`}
            aria-describedby={`${id}-${preset.id}`}
            className="group flex h-full w-full flex-col overflow-hidden rounded-card border border-line-strong bg-surface-1 text-left shadow-raised transition-[border-color,transform] duration-150 ease-standard hover:-translate-y-0.5 hover:border-accent/70 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            onClick={() => onChoose(preset)}
          >
            <StarterArt preset={preset} />
            <span className="flex flex-1 flex-col gap-1 p-3">
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink-100">{preset.name}</span>
                <span className="text-xs text-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  {actionLabel}
                </span>
              </span>
              <span id={`${id}-${preset.id}`} className="text-sm text-ink-300">
                {preset.summary}
              </span>
              <span className="mt-auto pt-1 text-xs text-ink-400">
                {preset.brandKit.name} · {String(preset.komaCount)} Komas
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
