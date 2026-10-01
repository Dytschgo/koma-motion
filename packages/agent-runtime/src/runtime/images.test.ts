import { describe, expect, it } from 'vitest';
import { buildProject } from '@koma-motion/core/testing';
import { buildGenerationRequest } from '../contract/request';
import { ProviderRegistry } from '../providers/registry';
import { buildResponse, ScriptedProvider } from '../testing/fixtures';
import { GenerationRunner } from './GenerationRunner';

describe('selected image backend in agent prompts', () => {
  it.each(['off', 'codex', 'grok'] as const)(
    'routes %s through generation and repair',
    async (selection) => {
      const project = buildProject();
      project.agentConfiguration.imageGeneration = selection;
      const request = buildGenerationRequest(project, {
        userRequest: 'Make an illustrated presentation.',
        objective: null,
        audience: null,
        requestedKomaCount: 3,
      });
      expect(request.imageGenerationEnabled).toBe(selection !== 'off');
      expect(request.imageProvider).toBe(selection === 'off' ? undefined : selection);
      const provider = new ScriptedProvider([
        'invalid JSON',
        JSON.stringify({
          ...buildResponse(),
          ...(selection !== 'off' ? { imageRequests: [] } : {}),
        }),
      ]);
      const runner = new GenerationRunner({ registry: new ProviderRegistry([provider]) });
      const result = await runner.execute({
        executionId: 'images',
        providerId: provider.id,
        request,
      });
      expect(result.status).toBe('succeeded');
      expect(provider.contexts).toHaveLength(2);
      for (const { prompt } of provider.contexts) {
        if (selection === 'off') {
          expect(prompt.system).not.toContain('Images: ON');
          expect(JSON.stringify(prompt.responseJsonSchema)).not.toContain('imageRequests');
        } else {
          expect(prompt.templateVersion).toBe(7);
          expect(prompt.system).toContain(
            `Selected image provider: ${selection === 'grok' ? 'Grok Imagine' : 'Codex'}`,
          );
          expect(prompt.system).toContain(
            selection === 'grok' ? 'Grok CLI image_gen' : 'Codex app-server image_generation',
          );
          expect(prompt.system).toContain(
            '"imageRequests": [{"persistentId":"hero-image","prompt":',
          );
          expect(prompt.system).toContain('existing sign-in');
          expect(prompt.system).toContain('Image model: managed by the selected CLI');
          expect(prompt.responseJsonSchema['required']).toContain('imageRequests');
        }
      }
    },
  );
});
