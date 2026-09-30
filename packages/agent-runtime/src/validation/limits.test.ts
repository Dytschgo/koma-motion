import { describe, expect, it } from 'vitest';
import {
  createSeededIdGenerator,
  MAX_ELEMENTS_PER_KOMA,
  MAX_ELEMENT_TEXT_LENGTH,
} from '@koma-motion/core';
import { agentPresentationResponseSchema, getResponseJsonSchema } from '../contract/response';
import { buildRequest, buildResponse } from '../testing/fixtures';
import { convertResponseToPresentation } from '../conversion/toPresentation';
import { MAX_AGENT_OUTPUT_BYTES, resolveProviderOutput } from './extract';
import { validateAgentResponse } from './validateResponse';

describe('technical response boundaries', () => {
  it('accepts exact UTF-8 byte boundaries and rejects excess text or envelopes', () => {
    const rawText = JSON.stringify({
      text: 'x'.repeat(MAX_AGENT_OUTPUT_BYTES - '{"text":""}'.length),
    });
    expect(Buffer.byteLength(rawText)).toBe(MAX_AGENT_OUTPUT_BYTES);
    expect(resolveProviderOutput({ rawText }).ok).toBe(true);
    for (const output of [
      { rawText: rawText + ' ' },
      { rawText: JSON.stringify({ text: 'あ'.repeat(Math.ceil(MAX_AGENT_OUTPUT_BYTES / 3)) }) },
      { rawText: '', structured: { text: 'x'.repeat(MAX_AGENT_OUTPUT_BYTES + 1) } },
    ]) {
      const result = resolveProviderOutput(output);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('outputTooLarge');
        expect(result.error.message).toContain('No partial presentation');
      }
    }
  });

  it('accepts the rendering budget and keeps text, identity and geometry validation', () => {
    const response = buildResponse();
    const koma = response.komas[0];
    const text = koma?.elements.find((element) => element.type === 'text');
    if (koma === undefined || text === undefined) throw new Error('Missing fixture');
    koma.elements = Array.from({ length: MAX_ELEMENTS_PER_KOMA }, (_, index) => ({
      ...text,
      persistentId: `item-${String(index)}`,
      text: index === 0 ? 'x'.repeat(MAX_ELEMENT_TEXT_LENGTH) : 'Text',
    }));
    expect(validateAgentResponse(response, buildRequest()).ok).toBe(true);
    expect(
      convertResponseToPresentation(response, {
        request: buildRequest(),
        idGenerator: createSeededIdGenerator('dense'),
      }).ok,
    ).toBe(true);
    koma.elements.push({ ...text, persistentId: 'extra' });
    expect(agentPresentationResponseSchema.safeParse(response).success).toBe(false);
    koma.elements.pop();
    const first = koma.elements[0];
    if (first === undefined) throw new Error('Missing element');
    first.text += 'x';
    expect(validateAgentResponse(response, buildRequest()).ok).toBe(false);
    first.text = 'Text';
    first.persistentId = 'item-1';
    expect(validateAgentResponse(response, buildRequest()).ok).toBe(false);
    first.persistentId = 'item-0';
    first.width = -1;
    expect(validateAgentResponse(response, buildRequest()).ok).toBe(false);
    expect(JSON.stringify(getResponseJsonSchema())).not.toContain('"maxItems":12');
  });
});
