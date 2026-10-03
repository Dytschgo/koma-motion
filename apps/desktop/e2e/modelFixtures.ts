import { MockAgentProvider, type ProviderModelListing } from '@koma-motion/agent-runtime';
import {
  ClaudeCodeProvider,
  CodexCliProvider,
  GrokCliProvider,
} from '@koma-motion/agent-runtime/node';
import type { ElectronApplication } from '@playwright/test';

/** Deliberately fixed test catalogs, never used by the application or a real provider. */
const catalogs: Record<string, readonly (readonly [string, string])[]> = {
  'claude-code': [
    ['claude-fable-5-1', 'Claude Fable 5.1'],
    ['claude-opus-5-5', 'Claude Opus 5.5'],
    ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
    ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5'],
    ['opus', 'Opus (latest)'],
    ['sonnet', 'Sonnet (latest)'],
  ],
  codex: [
    ['gpt-6.1-sol', 'GPT-6.1 Sol'],
    ['gpt-6-astra', 'GPT-6 Astra'],
  ],
  grok: [['grok-4.7', 'Grok 4.7']],
};
export const MODEL_FIXTURES: Record<string, ProviderModelListing> = Object.fromEntries(
  Object.entries(catalogs).map(([id, entries]) => [
    id,
    {
      status: 'listed',
      models: entries.map(([id, label]) => ({ id, label, reasoning: { status: 'unsupported' } })),
      defaultModel: null,
      checkedAt: new Date().toISOString(),
    },
  ]),
);

/** Uses the real preload/invoke path while replacing only CLI discovery in native tests. */
export async function mockModelDiscovery(
  application: ElectronApplication,
  listings: Record<string, ProviderModelListing> = MODEL_FIXTURES,
  delayMs = 0,
): Promise<void> {
  const providers = [
    new MockAgentProvider(),
    new ClaudeCodeProvider(),
    new CodexCliProvider(),
    new GrokCliProvider(),
  ].map((provider) => ({
    metadata: provider.metadata,
    detection: {
      providerId: provider.id,
      availability: 'available',
      version: 'test-fixture',
      message: 'Mock discovery fixture',
      checkedAt: new Date().toISOString(),
    },
  }));
  await application.evaluate(
    ({ ipcMain }, data) => {
      ipcMain.removeHandler('koma:providers:detect');
      ipcMain.handle('koma:providers:detect', () => ({ providers: data.providers }));
      ipcMain.removeHandler('koma:providers:list-models');
      ipcMain.handle(
        'koma:providers:list-models',
        async (_event, request: { providerId: string }) => {
          if (data.delayMs) await new Promise((resolve) => setTimeout(resolve, data.delayMs));
          return data.listings[request.providerId] ?? { status: 'unsupported' };
        },
      );
    },
    { providers, listings, delayMs },
  );
}
