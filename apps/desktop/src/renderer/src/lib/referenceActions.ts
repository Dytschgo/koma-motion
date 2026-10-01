import { generationInputSchema } from '@koma-motion/agent-runtime';
import { invoke } from './api';
import { useProjectStore } from '../state/projectStore';
import { useReferenceStore } from '../state/referenceStore';

export async function attachReferences(): Promise<void> {
  const { sessionId } = useProjectStore.getState();
  const state = useReferenceStore.getState();
  if (state.selecting) return;
  state.setSelecting(true);
  state.setError(null);
  try {
    const result = await invoke('koma:references:select', {});
    if (useProjectStore.getState().sessionId !== sessionId) return;
    if (result.status === 'failed') {
      useReferenceStore.getState().setError(result.message);
    } else if (result.status === 'selected') {
      const current = useReferenceStore.getState();
      const references = [
        ...(current.sessionId === sessionId ? current.references : []),
        ...result.references,
      ];
      const parsed = generationInputSchema.safeParse({
        userRequest: 'Check references',
        objective: null,
        audience: null,
        requestedKomaCount: null,
        references,
      });
      if (!parsed.success) {
        current.setError(
          'These references exceed the request limit. Remove a reference or attach a smaller selection.',
        );
        return;
      }
      current.setReferences(sessionId, references);
    }
  } catch {
    if (useProjectStore.getState().sessionId === sessionId)
      useReferenceStore
        .getState()
        .setError('The reference files could not be read. Try another file.');
  } finally {
    if (useProjectStore.getState().sessionId === sessionId)
      useReferenceStore.getState().setSelecting(false);
  }
}
