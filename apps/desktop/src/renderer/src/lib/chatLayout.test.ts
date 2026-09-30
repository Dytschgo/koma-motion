import { describe, expect, it } from 'vitest';
import { useUiStore } from '../state/uiStore';
import {
  CANVAS_MIN_WIDTH,
  CHAT_DEFAULT_WIDTH,
  CHAT_MAX_WIDTH,
  CHAT_MIN_WIDTH,
  DEFAULT_CHAT_PREFERENCES,
  INSPECTOR_WIDTH,
  clampChatWidth,
  getChatLayout,
  parseChatPreferences,
  serializeChatPreferences,
} from './chatLayout';

/** Width of the Koma strip on the left (`KomaStrip.tsx`). */
const KOMA_STRIP_WIDTH = 244;

describe('chat layout', () => {
  it('keeps the width between the minimum and the maximum', () => {
    expect(clampChatWidth(10)).toBe(CHAT_MIN_WIDTH);
    expect(clampChatWidth(5000)).toBe(CHAT_MAX_WIDTH);
    expect(clampChatWidth(412.6)).toBe(413);
    expect(clampChatWidth(500, 420)).toBe(420);
    // A maximum below the minimum never makes the chat unusably narrow.
    expect(clampChatWidth(500, 100)).toBe(CHAT_MIN_WIDTH);
  });

  it('uses the preferred width before the area is measured', () => {
    expect(getChatLayout({ available: 0, preferred: 450, inspector: INSPECTOR_WIDTH })).toEqual({
      width: 450,
      maxWidth: CHAT_MAX_WIDTH,
      replacesInspector: false,
    });
  });

  it('shows the canvas, the Inspector and the chat side by side in a wide window', () => {
    const available = 1480 - KOMA_STRIP_WIDTH;
    const layout = getChatLayout({
      available,
      preferred: CHAT_DEFAULT_WIDTH,
      inspector: INSPECTOR_WIDTH,
    });
    expect(layout).toEqual({
      width: CHAT_DEFAULT_WIDTH,
      maxWidth: available - INSPECTOR_WIDTH - CANVAS_MIN_WIDTH,
      replacesInspector: false,
    });
  });

  it('narrows the chat before the canvas becomes too small, and keeps the preference', () => {
    const available = 1480 - KOMA_STRIP_WIDTH;
    const layout = getChatLayout({ available, preferred: 640, inspector: INSPECTOR_WIDTH });
    expect(layout.width).toBe(available - INSPECTOR_WIDTH - CANVAS_MIN_WIDTH);
    expect(available - layout.width - INSPECTOR_WIDTH).toBe(CANVAS_MIN_WIDTH);
    expect(layout.replacesInspector).toBe(false);
  });

  it('shows the chat in place of the Inspector in a narrow window', () => {
    for (const windowWidth of [1024, 1120, 1200]) {
      const available = windowWidth - KOMA_STRIP_WIDTH;
      const layout = getChatLayout({
        available,
        preferred: CHAT_DEFAULT_WIDTH,
        inspector: INSPECTOR_WIDTH,
      });
      expect(layout.replacesInspector).toBe(true);
      expect(layout.width).toBeGreaterThanOrEqual(CHAT_MIN_WIDTH);
      expect(available - layout.width).toBeGreaterThanOrEqual(CANVAS_MIN_WIDTH);
    }
  });

  it('keeps the chat beside a view without an Inspector', () => {
    const layout = getChatLayout({
      available: 1120 - KOMA_STRIP_WIDTH,
      preferred: CHAT_DEFAULT_WIDTH,
      inspector: 0,
    });
    expect(layout).toEqual({
      width: CHAT_DEFAULT_WIDTH,
      maxWidth: 1120 - KOMA_STRIP_WIDTH - CANVAS_MIN_WIDTH,
      replacesInspector: false,
    });
  });
});

describe('chat preferences', () => {
  it('round-trips the stored preferences', () => {
    const preferences = { open: false, width: 512 };
    expect(parseChatPreferences(serializeChatPreferences(preferences))).toEqual(preferences);
  });

  it('falls back to the default for missing or damaged values', () => {
    expect(parseChatPreferences(null)).toEqual(DEFAULT_CHAT_PREFERENCES);
    expect(parseChatPreferences('not json')).toEqual(DEFAULT_CHAT_PREFERENCES);
    expect(parseChatPreferences('[]')).toEqual(DEFAULT_CHAT_PREFERENCES);
    expect(parseChatPreferences('{"open":"yes","width":"wide"}')).toEqual(DEFAULT_CHAT_PREFERENCES);
    expect(parseChatPreferences('{"open":false,"width":99999}')).toEqual({
      open: false,
      width: CHAT_MAX_WIDTH,
    });
  });

  it('keeps the chat preferences in the interface state when a project is replaced', () => {
    const store = useUiStore.getState();
    store.setAgentPanelOpen(false);
    store.setAgentPanelWidth(12);
    expect(useUiStore.getState().agentPanelWidth).toBe(CHAT_MIN_WIDTH);
    store.setAgentPanelWidth(480);
    useUiStore.getState().reset();
    expect(useUiStore.getState()).toMatchObject({ agentPanelOpen: false, agentPanelWidth: 480 });
    store.setAgentPanelOpen(true);
    store.setAgentPanelWidth(CHAT_DEFAULT_WIDTH);
  });
});
