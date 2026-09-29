import { describe, expect, it } from 'vitest';
import type { ResponseIssue } from '../contract/errors';
import { getResponseJsonSchema } from '../contract/response';
import { buildRequest, buildResponse } from '../testing/fixtures';
import { extractStructuredOutput, MAX_AGENT_OUTPUT_LENGTH } from './extract';
import { validateAgentResponse } from './validateResponse';

function issuesOf(output: unknown, request = buildRequest()): ResponseIssue[] {
  const result = validateAgentResponse(output, request);
  if (result.ok) {
    throw new Error('Expected the response to be rejected');
  }
  expect(result.error.code).toBe('invalidResponse');
  return result.error.issues;
}

describe('extractStructuredOutput', () => {
  it('reads a JSON object', () => {
    expect(extractStructuredOutput(' {"a":1} ')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('reads a JSON object from a Markdown code fence', () => {
    const text = 'Here is the presentation:\n```json\n{"a":{"b":"}"}}\n```\nDone.';
    expect(extractStructuredOutput(text)).toEqual({ ok: true, value: { a: { b: '}' } } });
  });

  it('skips braces that are not JSON', () => {
    expect(extractStructuredOutput('Use {curly} braces. {"a":1}')).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it.each([
    ['prose', 'I could not create a presentation.'],
    ['an empty response', '   '],
    ['an array', '[1,2,3]'],
    ['truncated JSON', '{"komas":[{"key":"a"'],
  ])('rejects %s', (_label, text) => {
    const result = extractStructuredOutput(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('noStructuredOutput');
    }
  });

  it('rejects output above the size limit', () => {
    const result = extractStructuredOutput(`{"a":"${'x'.repeat(MAX_AGENT_OUTPUT_LENGTH)}"}`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('outputTooLarge');
    }
  });

  it('does not evaluate code', () => {
    const result = extractStructuredOutput('(function(){ globalThis.compromised = true })()');
    expect(result.ok).toBe(false);
    expect('compromised' in globalThis).toBe(false);
  });
});

describe('validateAgentResponse', () => {
  it('accepts a valid response', () => {
    const result = validateAgentResponse(buildResponse(), buildRequest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.response.komas).toHaveLength(3);
      expect(result.value.warnings).toEqual([]);
    }
  });

  it('warns when the number of Komas differs from the request', () => {
    const result = validateAgentResponse(buildResponse(), buildRequest({ requestedKomaCount: 5 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warnings).toEqual(['5 Komas were requested, the agent created 3.']);
    }
  });

  it('rejects a response without Komas', () => {
    const { komas: _komas, ...withoutKomas } = buildResponse();
    expect(issuesOf(withoutKomas)[0]).toMatchObject({ code: 'schema', path: 'komas' });
    expect(issuesOf({ ...buildResponse(), komas: [], transitions: [] })[0]).toMatchObject({
      code: 'schema',
      path: 'komas',
    });
  });

  it('rejects malformed values and names their location', () => {
    const response = buildResponse();
    const broken = structuredClone(response);
    Object.assign(broken.komas[0]?.elements[0] ?? {}, { width: -5, textColour: 'red' });
    const issues = issuesOf(broken);
    expect(issues.map((issue) => issue.path).sort()).toEqual([
      'komas[0].elements[0].textColour',
      'komas[0].elements[0].width',
    ]);
  });

  it('rejects unsupported element types by name', () => {
    const broken = structuredClone(buildResponse());
    Object.assign(broken.komas[1]?.elements[2] ?? {}, { type: 'video' });
    expect(issuesOf(broken)).toEqual([
      {
        code: 'unsupportedElementType',
        path: 'komas[1].elements[2].type',
        message: 'The element type "video" is not supported. Supported types: text, shape, image.',
      },
    ]);
  });

  it('rejects element types that the request does not allow', () => {
    const broken = structuredClone(buildResponse());
    Object.assign(broken.komas[0]?.elements[0] ?? {}, { type: 'image', assetId: 'asset-logo' });
    const issues = issuesOf(broken, buildRequest({ allowedElementTypes: ['text', 'shape'] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'unsupportedElementType' });
  });

  it('rejects unsupported transition strategies and easings', () => {
    const broken = structuredClone(buildResponse());
    Object.assign(broken.transitions[0] ?? {}, { strategy: 'explode', easing: 'bounce' });
    expect(issuesOf(broken).map((issue) => [issue.code, issue.path])).toEqual([
      ['unsupportedTransition', 'transitions[0].strategy'],
      ['unsupportedTransition', 'transitions[0].easing'],
    ]);
  });

  it('rejects transitions that refer to missing Komas', () => {
    const broken = structuredClone(buildResponse());
    Object.assign(broken.transitions[0] ?? {}, { toKoma: 'nowhere' });
    expect(issuesOf(broken)).toEqual([
      {
        code: 'invalidReference',
        path: 'transitions[0].toKoma',
        message: 'The transition ends at Koma "nowhere", which does not exist.',
      },
    ]);
  });

  it('rejects transitions between Komas that do not follow one another', () => {
    const broken = structuredClone(buildResponse());
    Object.assign(broken.transitions[0] ?? {}, { toKoma: 'editable-result' });
    const issues = issuesOf(broken);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('invalidReference');
  });

  it('rejects duplicate Koma keys and duplicate persistent ids', () => {
    const broken = structuredClone(buildResponse());
    Object.assign(broken.komas[1] ?? {}, { key: 'system' });
    Object.assign(broken.komas[0]?.elements[1] ?? {}, { persistentId: 'title' });
    const codes = issuesOf(broken).map((issue) => [issue.code, issue.path]);
    expect(codes).toContainEqual(['duplicateId', 'komas[1].key']);
    expect(codes).toContainEqual(['duplicateId', 'komas[0].elements[1].persistentId']);
  });

  it('rejects images that use assets outside the project', () => {
    const broken = structuredClone(buildResponse());
    Object.assign(broken.komas[0]?.elements[0] ?? {}, {
      type: 'image',
      assetId: 'C-Users-me-secret',
    });
    const issues = issuesOf(
      broken,
      buildRequest({
        allowedElementTypes: ['text', 'shape', 'image'],
        availableAssets: [{ id: 'asset-logo', name: 'logo.png' }],
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'invalidReference',
      path: 'komas[0].elements[0].assetId',
    });
  });

  it('rejects asset ids that look like paths', () => {
    const broken = structuredClone(buildResponse());
    Object.assign(broken.komas[0]?.elements[0] ?? {}, {
      type: 'image',
      assetId: '../../etc/passwd',
    });
    expect(issuesOf(broken)[0]).toMatchObject({
      code: 'schema',
      path: 'komas[0].elements[0].assetId',
    });
  });

  it('rejects elements without the content their type needs', () => {
    const broken = structuredClone(buildResponse());
    Object.assign(broken.komas[0]?.elements[0] ?? {}, { text: null });
    expect(issuesOf(broken)).toEqual([
      {
        code: 'missingContent',
        path: 'komas[0].elements[0].text',
        message: 'A text element needs "text".',
      },
    ]);
  });

  it('rejects responses above the limits of the request', () => {
    const request = buildRequest({
      constraints: { maxKomas: 2, maxElementsPerKoma: 5, maxTextLength: 10 },
    });
    const codes = issuesOf(buildResponse(), request).map((issue) => issue.code);
    expect(new Set(codes)).toEqual(new Set(['limitExceeded']));
    expect(codes.length).toBeGreaterThan(3);
  });

  it.each([null, 'text', 42, []])('rejects %o', (output) => {
    expect(issuesOf(output).length).toBeGreaterThan(0);
  });
});

describe('getResponseJsonSchema', () => {
  it('describes the response contract without optional properties', () => {
    const schema = getResponseJsonSchema();
    expect(schema['type']).toBe('object');
    expect(schema['required']).toEqual([
      'presentation',
      'komas',
      'transitions',
      'visualRationale',
      'warnings',
    ]);
    expect(schema).not.toHaveProperty('$schema');
    expect(JSON.stringify(schema).length).toBeLessThan(12000);
  });
});
