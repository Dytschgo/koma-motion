import { describe, it, expect } from 'vitest';
import { buildRequest, buildResponse } from '../testing/fixtures';
import { validateAgentResponse } from './validateResponse';
import { getResponseJsonSchema } from '../contract/response';

describe('requested image placement', () => {
  it('only requests image briefs in the opt-in response schema', () => {
    expect(JSON.stringify(getResponseJsonSchema())).not.toContain('imageRequests');
    expect(getResponseJsonSchema(true)['required']).toContain('imageRequests');
  });
  it('accepts a reserved shape and rejects disabled, missing, duplicate or text targets', () => {
    const response = buildResponse();
    const shapes = response.komas.flatMap((koma) => koma.elements);
    const shape = shapes.find((element) => element.type === 'shape');
    const text = shapes.find((element) => element.type === 'text');
    if (!shape || !text) throw new Error('Missing fixtures');
    const brief = { persistentId: shape.persistentId, prompt: 'A blue illustration' };
    expect(
      validateAgentResponse(
        { ...response, imageRequests: [brief] },
        buildRequest({ imageGenerationEnabled: true }),
      ).ok,
    ).toBe(true);
    expect(validateAgentResponse({ ...response, imageRequests: [brief] }, buildRequest()).ok).toBe(
      false,
    );
    for (const imageRequests of [
      [brief, brief],
      [{ ...brief, persistentId: 'missing-shape' }],
      [{ ...brief, persistentId: text.persistentId }],
    ]) {
      expect(
        validateAgentResponse(
          { ...response, imageRequests },
          buildRequest({ imageGenerationEnabled: true }),
        ).ok,
      ).toBe(false);
    }
  });
});
