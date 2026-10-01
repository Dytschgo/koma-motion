import type { ReactElement } from 'react';
import claude from '../assets/providers/claude-color.svg';
import openai from '../assets/providers/openai.svg';
import grok from '../assets/providers/grok.svg';
import { KomaMark } from './icons';

/** Bundled provider marks: no network request is made by the renderer. */
export function ProviderLogo({
  providerId,
  size = 18,
}: {
  readonly providerId: string;
  readonly size?: number;
}): ReactElement {
  const source =
    providerId === 'claude-code'
      ? claude
      : providerId === 'codex'
        ? openai
        : providerId === 'grok'
          ? grok
          : null;
  return (
    <span
      aria-hidden="true"
      data-provider-logo={providerId}
      className="inline-flex flex-none items-center justify-center"
      style={{ width: size, height: size }}
    >
      {source === null ? (
        <KomaMark size={size} />
      ) : (
        <img
          src={source}
          alt=""
          width={size}
          height={size}
          className={providerId === 'claude-code' ? '' : 'brightness-0 invert'}
          draggable={false}
        />
      )}
    </span>
  );
}
