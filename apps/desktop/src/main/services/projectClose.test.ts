import { describe, expect, it, vi } from 'vitest';
import { createProjectSession } from './projectFiles';
import { finishCleanClose } from './projectClose';

// Only the session shape is used; no native dialog or filesystem action is called.
vi.mock('electron', () => ({ dialog: {} }));
function heldFlush() {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { flush: () => pending, release };
}

describe('closing after a recovery flush', () => {
  it('asks again instead of authorizing close when edits arrive during a blocked flush', async () => {
    const session = createProjectSession();
    const held = heldFlush();
    let open = true;
    const confirm = vi.fn(() => {
      open = false;
    });
    // Models the existing native prompt choosing Cancel: no confirm is issued.
    const askAgain = vi.fn();
    const closing = finishCleanClose(session, held.flush, {
      isOpen: () => open,
      confirm,
      askAgain,
    });
    session.hasUnsavedChanges = true;
    expect(confirm).not.toHaveBeenCalled();
    held.release();
    await closing;
    expect(confirm).not.toHaveBeenCalled();
    expect(askAgain).toHaveBeenCalledOnce();
    expect(open).toBe(true);
    expect(session.hasUnsavedChanges).toBe(true);
  });

  it('does not close a replacement project after an earlier project requested close', async () => {
    const session = createProjectSession();
    const held = heldFlush();
    const actions = { isOpen: () => true, confirm: vi.fn(), askAgain: vi.fn() };
    const closing = finishCleanClose(session, held.flush, actions);
    session.sessionId += 1;
    held.release();
    await closing;
    expect(actions.confirm).not.toHaveBeenCalled();
    expect(actions.askAgain).not.toHaveBeenCalled();
  });

  it('closes the unchanged clean session only after its flush finishes', async () => {
    const session = createProjectSession();
    const held = heldFlush();
    const actions = { isOpen: () => true, confirm: vi.fn(), askAgain: vi.fn() };
    const closing = finishCleanClose(session, held.flush, actions);
    expect(actions.confirm).not.toHaveBeenCalled();
    held.release();
    await closing;
    expect(actions.confirm).toHaveBeenCalledOnce();
    expect(actions.askAgain).not.toHaveBeenCalled();
  });
});
