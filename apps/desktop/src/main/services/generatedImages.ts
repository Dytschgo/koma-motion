import type { AgentPresentationResponse } from '@koma-motion/agent-runtime';
import {
  generateCodexImage,
  generateGrokImage,
  type ImageGenerator,
} from '@koma-motion/agent-runtime/node';
import { MAX_EMBEDDED_ASSET_BYTES, type AssetReference, type IdGenerator } from '@koma-motion/core';
import { imageSize } from 'image-size';
import { createImageAsset } from './imageAsset';

export async function generateRequestedImages(options: {
  readonly response: AgentPresentationResponse;
  readonly provider: 'codex' | 'grok';
  readonly signal: AbortSignal;
  readonly idGenerator: IdGenerator;
  readonly onProgress: (message: string) => void;
  readonly generateImage?: ImageGenerator;
}): Promise<{ response: AgentPresentationResponse; assets: AssetReference[] }> {
  const assets: AssetReference[] = [];
  const replacements = new Map<string, string>();
  const requests = options.response.imageRequests ?? [];
  for (const [index, request] of requests.entries()) {
    options.signal.throwIfAborted();
    options.onProgress(
      `Generating image ${String(index + 1)} of ${String(requests.length)} with ${options.provider === 'grok' ? 'Grok' : 'Codex'}`,
    );
    const raw = await (
      options.generateImage ??
      (options.provider === 'grok' ? generateGrokImage : generateCodexImage)
    )(request.prompt, options.signal);
    options.signal.throwIfAborted();
    const size = imageSize(raw);
    if (!size.width || !size.height || size.width * size.height > 16_777_216)
      throw new Error('The generated image dimensions exceed the import limit.');
    const { nativeImage } = await import('electron');
    let image = nativeImage.createFromBuffer(Buffer.from(raw));
    if (image.isEmpty()) throw new Error('The provider returned an unreadable image.');
    let bytes = image.toPNG();
    for (const width of [1600, 1200, 800, 400]) {
      if (bytes.length <= MAX_EMBEDDED_ASSET_BYTES) break;
      if (image.getSize().width > width) image = image.resize({ width });
      bytes = image.toPNG();
    }
    const asset = createImageAsset({
      bytes,
      fileName: `Generated ${request.persistentId}.png`,
      idGenerator: options.idGenerator,
    });
    if (!asset.ok) throw new Error(asset.error);
    assets.push(asset.value);
    replacements.set(request.persistentId, asset.value.id);
  }
  return {
    assets,
    response: {
      ...options.response,
      imageRequests: [],
      komas: options.response.komas.map((koma) => ({
        ...koma,
        elements: koma.elements.map((element) => {
          const assetId = replacements.get(element.persistentId);
          return assetId === undefined
            ? element
            : {
                ...element,
                type: 'image' as const,
                assetId,
                shape: null,
                cornerRadius: null,
                fillColour: null,
                strokeColour: null,
                strokeWidth: null,
              };
        }),
      })),
    },
  };
}
