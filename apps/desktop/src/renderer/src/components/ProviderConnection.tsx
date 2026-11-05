import type { ReactElement } from 'react';

/** Explains the connection boundary; motion indicates a check, never generation progress. */
export function ProviderConnection({
  detection,
  hasProviders,
}: {
  readonly detection: 'idle' | 'running' | 'done' | 'failed';
  readonly hasProviders: boolean;
}): ReactElement {
  const checking = detection === 'running' || detection === 'idle';
  const failed = detection === 'failed';
  return (
    <div className="provider-connection" data-checking={checking}>
      <svg viewBox="0 0 480 76" aria-hidden="true" focusable="false">
        <g fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="4" y="6" width="128" height="40" rx="8" />
          <rect x="176" y="6" width="128" height="40" rx="8" />
          <rect x="348" y="6" width="128" height="40" rx="8" />
          <path d="M132 26h44m128 0h44" strokeDasharray="3 4" />
          <path d="m169 22 7 4-7 4m172-8 7 4-7 4" />
        </g>
        <g fill="currentColor" textAnchor="middle" fontSize="12">
          <text x="68" y="30">
            Koma Motion
          </text>
          <text x="240" y="30">
            Local provider CLI
          </text>
          <text x="412" y="30">
            Online service
          </text>
          <text x="154" y="69" fontSize="10">
            Checked on this computer
          </text>
          <text x="390" y="69" fontSize="10">
            When generating
          </text>
        </g>
        <circle className="provider-check-pulse" cx="154" cy="26" r="3" fill="currentColor" />
      </svg>
      <p role={failed ? 'alert' : 'status'} className={failed ? 'text-signal-warn' : 'font-medium'}>
        {failed
          ? 'Provider check failed. Choose Refresh providers to retry.'
          : checking
            ? 'Checking installed providers…'
            : hasProviders
              ? 'Provider check complete.'
              : 'Provider check complete. No providers found.'}
      </p>
      {hasProviders && (checking || failed) && (
        <p className="text-sm text-ink-300">The results below are from the last completed check.</p>
      )}
      <p className="text-sm text-ink-300">
        Checks find installed programs. Sign-in and service access are confirmed when you generate.
        For an unavailable provider, follow its message below, then check again.
      </p>
    </div>
  );
}
