import { userRequestSchema } from '@koma-motion/agent-runtime';
import type { KomaProject } from '@koma-motion/core';
import { useEffect, useRef, useState } from 'react';
import { generate } from './agentActions';
import { DEFAULT_KOMA_COUNT, parseKomaCount } from './composerChoices';
import { useAgentStore } from '../state/agentStore';
import { useProjectStore } from '../state/projectStore';
import { useReferenceStore } from '../state/referenceStore';
import { useUiStore } from '../state/uiStore';
import { useBrandKitLibraryStore } from '../state/brandKitLibraryStore';

export const EXAMPLE_REQUEST =
  'Create three Komas introducing Koma Motion. Start with the complete system, focus on the motion engine, then show how the result stays editable in Koma Motion.';

/** Kept mounted across sidebar collapse; the project session owns its draft. */
export function useComposerDraft(project: KomaProject) {
  const providers = useAgentStore((state) => state.providers);
  const detection = useAgentStore((state) => state.detection);
  const execution = useAgentStore((state) => state.execution);
  const proposal = useAgentStore((state) => state.scopedProposal);
  const selectedKomaId = useUiStore((state) => state.selectedKomaId);
  const selectedKoma = project.presentation.komas.find((koma) => koma.id === selectedKomaId);
  const sessionId = useProjectStore((state) => state.sessionId);
  const referenceState = useReferenceStore();
  const references = referenceState.sessionId === sessionId ? referenceState.references : [];
  const [referenceConsent, setReferenceConsent] = useState<string | null>(null);
  const [scope, setScope] = useState<'entire' | 'selected'>('entire');
  const [request, setRequest] = useState('');
  const [komaCount, setKomaCount] = useState(String(DEFAULT_KOMA_COUNT));
  const [autoKomaCount, setAutoKomaCount] = useState(false);
  const count = scope === 'selected' ? 1 : parseKomaCount(autoKomaCount, komaCount);
  const validCount = count !== undefined;
  const requestValidation = userRequestSchema.safeParse(request);
  const requestError =
    request.trim() === '' || requestValidation.success
      ? undefined
      : requestValidation.error.issues[0]?.message;
  const selectedId = project.agentConfiguration.selectedProviderId;
  const selected = providers.find((provider) => provider.metadata.id === selectedId);
  const available = selected?.detection.availability === 'available';
  const providerName = selected?.metadata.displayName ?? selectedId;
  const running = execution !== null;
  const brandBusy = useBrandKitLibraryStore((state) => state.busy);
  const trimmed = request.trim();
  const consentKey = `${String(sessionId)}:${selectedId}:${references.map((reference) => reference.id).join(',')}`;
  const needsReferenceConsent =
    references.length > 0 && selected?.metadata.usesExternalService === true;
  const referencesReady =
    !referenceState.selecting && (!needsReferenceConsent || referenceConsent === consentKey);
  const canSubmit =
    trimmed !== '' &&
    requestValidation.success &&
    validCount &&
    !running &&
    proposal === null &&
    (scope !== 'selected' || selectedKoma !== undefined) &&
    !brandBusy &&
    available &&
    referencesReady;

  const draftSession = useRef(sessionId);
  useEffect(() => {
    if (draftSession.current === sessionId) return;
    draftSession.current = sessionId;
    setRequest('');
    setKomaCount(String(DEFAULT_KOMA_COUNT));
    setAutoKomaCount(false);
    setReferenceConsent(null);
    setScope('entire');
  }, [sessionId]);
  // Apply a starter after clearing the old session's draft, so its request/count win.
  const composerSeed = useUiStore((state) => state.composerSeed);
  const seedComposer = useUiStore((state) => state.seedComposer);
  // A starter puts its first request into the composer, ready to send.
  useEffect(() => {
    if (composerSeed === null) return;
    setRequest(composerSeed.request);
    setKomaCount(String(composerSeed.komaCount));
    setAutoKomaCount(false);
    seedComposer(null);
  }, [composerSeed, seedComposer]);

  const submit = (text: string): void => {
    if (
      !userRequestSchema.safeParse(text).success ||
      count === undefined ||
      running ||
      proposal !== null ||
      (scope === 'selected' && selectedKoma === undefined) ||
      brandBusy ||
      !available ||
      !referencesReady
    ) {
      return;
    }
    setRequest('');
    setReferenceConsent(null);
    void generate({
      userRequest: text.trim(),
      objective: null,
      // The agent infers the audience from the request.
      audience: null,
      requestedKomaCount: count,
      ...(scope === 'selected' && selectedKoma ? { targetKomaId: selectedKoma.id } : {}),
      ...(references.length > 0 ? { references: [...references] } : {}),
    });
  };

  return {
    request,
    setRequest,
    requestError,
    scope,
    setScope,
    sessionId,
    proposal,
    selectedKoma,
    running,
    selectedId,
    selected,
    providers,
    detection,
    available,
    providerName,
    validCount,
    komaCount,
    setKomaCount,
    autoKomaCount,
    setAutoKomaCount,
    canSubmit,
    references,
    needsReferenceConsent,
    referenceConsent,
    setReferenceConsent,
    consentKey,
    submit,
  };
}
export type ComposerDraft = ReturnType<typeof useComposerDraft>;
