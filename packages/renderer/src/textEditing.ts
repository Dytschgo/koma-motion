import { textElementSchema, type TextElement } from '@koma-motion/core';

/** Validate without truncating/normalising the draft, then use the host's document command. */
export function commitTextDraft(
  original: TextElement,
  text: string,
  commit: (element: TextElement) => void,
): string | null {
  if (text === original.content.text) return null;
  const result = textElementSchema.safeParse({
    ...original,
    content: { ...original.content, text },
  });
  if (!result.success) return result.error.issues[0]?.message ?? 'This text could not be saved.';
  try {
    commit(result.data);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'This text could not be saved. Try again.';
  }
}
