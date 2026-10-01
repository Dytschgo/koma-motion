import { findMatchingSavedKit } from '@koma-motion/brand-kit';
import type { KomaProject } from '@koma-motion/core';
import { useEffect, useMemo, useState } from 'react';
import type { SavedBrandKitSummary } from '../../../shared/ipc';
import { selectSavedKits, useBrandKitLibraryStore } from '../state/brandKitLibraryStore';

/**
 * SHA-256 of the project's logo, computed in the window with Web Crypto.
 * `undefined` while it is computed or when it cannot be, `null` without a logo.
 */
function useLogoSha256(project: KomaProject): string | null | undefined {
  const asset = project.assets.find((candidate) => candidate.id === project.brandKit.logoAssetId);
  const data = asset?.embeddedData?.data ?? null;
  const [result, setResult] = useState<{ data: string; hash: string | undefined } | null>(null);

  useEffect(() => {
    if (data === null) {
      return;
    }
    let cancelled = false;
    const finish = (hash: string | undefined): void => {
      if (!cancelled) {
        setResult({ data, hash });
      }
    };
    try {
      const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
      crypto.subtle
        .digest('SHA-256', bytes)
        .then((digest) => {
          finish(
            Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
              '',
            ),
          );
        })
        .catch(() => {
          finish(undefined);
        });
    } catch {
      queueMicrotask(() => {
        finish(undefined);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [data]);

  if (data === null) {
    return null;
  }
  return result?.data === data ? result.hash : undefined;
}

/** The saved kits the project matches: the same settings and the same logo bytes. */
export function useMatchingKits(project: KomaProject): readonly SavedBrandKitSummary[] {
  const kits = useBrandKitLibraryStore(selectSavedKits);
  const logoHash = useLogoSha256(project);
  const { brandKit } = project;
  return useMemo(
    () =>
      logoHash === undefined
        ? []
        : kits.filter((kit) => findMatchingSavedKit([kit], brandKit, logoHash) !== undefined),
    [kits, logoHash, brandKit],
  );
}
