import { buildProject } from '@koma-motion/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReferenceSelectionOutcome } from '../../../shared/references';
import { useProjectStore } from '../state/projectStore';
import { useReferenceStore } from '../state/referenceStore';
import { invoke } from './api';
import { attachReferences } from './referenceActions';

vi.mock('./api', () => ({ invoke: vi.fn() }));
const reference = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'brief.txt',
  format: 'txt',
  text: 'Reference content',
  truncated: false,
} as const;

describe('reference attachment ownership', () => {
  beforeEach(() => {
    useProjectStore.getState().load(buildProject(), null);
    useReferenceStore.getState().clear();
    vi.mocked(invoke).mockReset();
  });
  it('keeps references outside project history and leaves attachments after cancelling a selection', async () => {
    const before = useProjectStore.getState().history;
    vi.mocked(invoke).mockResolvedValueOnce({ status: 'selected', references: [reference] });
    await attachReferences();
    expect(useReferenceStore.getState().references).toEqual([reference]);
    expect(useProjectStore.getState().history).toBe(before);
    vi.mocked(invoke).mockResolvedValueOnce({ status: 'cancelled' });
    await attachReferences();
    expect(useReferenceStore.getState().references).toEqual([reference]);
  });
  it('discards files returned after another project replaces the original', async () => {
    let finish: (value: ReferenceSelectionOutcome) => void = () => undefined;
    vi.mocked(invoke).mockReturnValueOnce(
      new Promise<ReferenceSelectionOutcome>((resolve) => {
        finish = resolve;
      }),
    );
    const pending = attachReferences();
    useProjectStore.getState().load(buildProject({ id: 'replacement' }), null);
    useReferenceStore.getState().clear();
    finish({ status: 'selected', references: [reference] });
    await pending;
    expect(useReferenceStore.getState().references).toEqual([]);
    expect(useReferenceStore.getState().selecting).toBe(false);
  });
  it('refuses a combined attachment count above the request budget without losing existing files', async () => {
    const existing = Array.from({ length: 5 }, (_, index) => ({
      ...reference,
      id: `11111111-1111-4111-8111-11111111111${String(index)}`,
    }));
    useReferenceStore.getState().setReferences(useProjectStore.getState().sessionId, existing);
    vi.mocked(invoke).mockResolvedValueOnce({ status: 'selected', references: [reference] });
    await attachReferences();
    expect(useReferenceStore.getState().references).toEqual(existing);
    expect(useReferenceStore.getState().error).toContain('exceed');
  });
});
