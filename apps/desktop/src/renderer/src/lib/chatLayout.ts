/**
 * Width of the chat sidebar. Pure functions, so that the layout rules can be
 * tested without a window. The preferences are interface state: they are
 * kept by the application, never in the project document.
 */

export const CHAT_MIN_WIDTH = 300;
export const CHAT_MAX_WIDTH = 640;
export const CHAT_DEFAULT_WIDTH = 380;
/** One step of the resize control with the arrow keys; Shift moves four steps. */
export const CHAT_RESIZE_STEP = 16;
/** The canvas and its preview controls stay usable down to this width. */
export const CANVAS_MIN_WIDTH = 420;
export interface ChatPreferences {
  readonly open: boolean;
  /** The width the user chose. The sidebar is narrower when the window has no room. */
  readonly width: number;
}

export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = {
  open: true,
  width: CHAT_DEFAULT_WIDTH,
};

export function clampChatWidth(width: number, maximum = CHAT_MAX_WIDTH): number {
  const upper = Math.max(CHAT_MIN_WIDTH, Math.min(CHAT_MAX_WIDTH, maximum));
  return Math.round(Math.min(upper, Math.max(CHAT_MIN_WIDTH, width)));
}

export interface ChatLayout {
  /** The width the sidebar is shown with. */
  readonly width: number;
  /** The widest the sidebar can be made in the current window. */
  readonly maxWidth: number;
}

/**
 * Decides how wide the chat is. `available` is the width shared by the main
 * area and the shared Chat/Inspect dock. Before the area is measured
 * (`available` is 0) the preferred width is used. Switching contexts never
 * changes the canvas width.
 */
export function getChatLayout(input: {
  readonly available: number;
  readonly preferred: number;
}): ChatLayout {
  const { available, preferred } = input;
  if (available <= 0) {
    return {
      width: clampChatWidth(preferred),
      maxWidth: CHAT_MAX_WIDTH,
    };
  }
  const maxWidth = clampChatWidth(available - CANVAS_MIN_WIDTH);
  return {
    width: clampChatWidth(preferred, maxWidth),
    maxWidth,
  };
}

/** Reads stored preferences. Anything unexpected falls back to the default. */
export function parseChatPreferences(stored: string | null): ChatPreferences {
  if (stored === null) {
    return DEFAULT_CHAT_PREFERENCES;
  }
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return DEFAULT_CHAT_PREFERENCES;
  }
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_CHAT_PREFERENCES;
  }
  const open = 'open' in value ? value.open : undefined;
  const width = 'width' in value ? value.width : undefined;
  return {
    open: typeof open === 'boolean' ? open : DEFAULT_CHAT_PREFERENCES.open,
    width:
      typeof width === 'number' && Number.isFinite(width)
        ? clampChatWidth(width)
        : DEFAULT_CHAT_PREFERENCES.width,
  };
}

export function serializeChatPreferences(preferences: ChatPreferences): string {
  return JSON.stringify({ open: preferences.open, width: preferences.width });
}
