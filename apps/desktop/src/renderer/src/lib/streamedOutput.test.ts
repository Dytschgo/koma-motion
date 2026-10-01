import { describe, expect, it } from 'vitest';
import {
  appendStreamedOutput,
  EMPTY_STREAMED_OUTPUT,
  MAX_STREAMED_CHARACTERS,
} from './streamedOutput';

describe('streamed output', () => {
  it('appends text in the order it arrives', () => {
    let output = appendStreamedOutput(EMPTY_STREAMED_OUTPUT, { attempt: 1, text: 'I will ' });
    output = appendStreamedOutput(output, { attempt: 1, text: 'create three Komas.' });
    expect(output).toEqual({ attempt: 1, text: 'I will create three Komas.', truncated: false });
  });

  it('starts over for a repair attempt and ignores late text of the first attempt', () => {
    let output = appendStreamedOutput(EMPTY_STREAMED_OUTPUT, { attempt: 1, text: 'First.' });
    output = appendStreamedOutput(output, { attempt: 2, text: 'Correcting.' });
    expect(output).toEqual({ attempt: 2, text: 'Correcting.', truncated: false });
    expect(appendStreamedOutput(output, { attempt: 1, text: ' late' })).toBe(output);
  });

  it('keeps the newest text within the limit and marks the cut', () => {
    let output = EMPTY_STREAMED_OUTPUT;
    for (let index = 0; index < 50; index += 1) {
      output = appendStreamedOutput(output, { attempt: 1, text: `word${String(index)} ` }, 60);
    }
    expect(output.text.length).toBeLessThanOrEqual(60);
    expect(output.text.endsWith('word49 ')).toBe(true);
    expect(output.text.startsWith('word')).toBe(true);
    expect(output.truncated).toBe(true);
  });

  it('bounds a single very long piece of text', () => {
    const output = appendStreamedOutput(EMPTY_STREAMED_OUTPUT, {
      attempt: 1,
      text: 'x'.repeat(MAX_STREAMED_CHARACTERS * 3),
    });
    expect(output.text).toHaveLength(MAX_STREAMED_CHARACTERS);
    expect(output.truncated).toBe(true);
  });
});
