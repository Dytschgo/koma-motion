import { app, dialog } from 'electron';
import { BRAND_PROFILE_FILE_EXTENSIONS, BrandProfileService } from '../../services/brandProfile';
import { DeckAnalysisService } from '../../services/deckAnalysis';
import { selectLogo } from '../../services/logo';
import type { HandlerScope } from './scope';

/**
 * Brand Kits: the saved library, and the two ways to derive one from material
 * the user chooses (a deck, or images and documents).
 */
export function registerBrandHandlers({
  context,
  handle,
  send,
  registry,
}: Omit<HandlerScope, 'cancelWork'>): {
  /** Stops analyses that are running and resolves when they have ended. */
  cancel(): Promise<void>;
} {
  const { window, brandKits } = context;

  const decks = new DeckAnalysisService({
    registry,
    library: brandKits,
    allowMock: !app.isPackaged,
    progress: (event) => send('koma:deck:progress', event),
    select: async () => {
      const result = await dialog.showOpenDialog(window, {
        title: 'Create Brand Kit from deck',
        filters: [{ name: 'Presentation decks', extensions: ['pptx', 'pdf'] }],
        properties: ['openFile'],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
  });
  const profiles = new BrandProfileService({
    registry,
    library: brandKits,
    allowMock: !app.isPackaged,
    progress: (event) => send('koma:brand-profile:progress', event),
    // The only source of paths. They stay in the main process.
    select: async () => {
      const result = await dialog.showOpenDialog(window, {
        title: 'Attach brand material',
        filters: [
          { name: 'Images, PDF and PowerPoint', extensions: [...BRAND_PROFILE_FILE_EXTENSIONS] },
        ],
        properties: ['openFile', 'multiSelections'],
      });
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths;
    },
  });

  handle('koma:deck:capabilities', async () => ({
    allowMock: !app.isPackaged,
    claude: await registry.get('claude-code')!.detect(),
  }));
  handle('koma:deck:prepare', ({ sessionId }) => decks.prepare(sessionId));
  handle('koma:deck:analyze', ({ sessionId, provider }) => decks.analyze(sessionId, provider));
  handle('koma:deck:cancel', async ({ sessionId }) => {
    await decks.cancel(sessionId);
    return {};
  });
  handle('koma:deck:save', ({ sessionId, name, brandKit, logoCandidateId }) =>
    decks.save(sessionId, name, brandKit, logoCandidateId),
  );

  handle('koma:brand-profile:attach', ({ sessionId }) => profiles.attach(sessionId));
  handle('koma:brand-profile:analyze', ({ sessionId, provider }) =>
    profiles.analyze(sessionId, provider),
  );
  handle('koma:brand-profile:cancel', async ({ sessionId, scope }) => {
    await (scope === 'analysis' ? profiles.stopAnalysis(sessionId) : profiles.cancel(sessionId));
    return {};
  });
  handle('koma:brand-profile:save', ({ sessionId, ...reviewed }) =>
    profiles.save(sessionId, reviewed),
  );

  handle('koma:brand-kit:select-logo', () => selectLogo(window));
  handle('koma:brand-kits:list', () => brandKits.list());
  handle('koma:brand-kits:create', (request) => brandKits.create(request));
  handle('koma:brand-kits:update', ({ id, brandKit, logo }) =>
    brandKits.update(id, { brandKit, logo }),
  );
  handle('koma:brand-kits:rename', ({ id, name }) => brandKits.rename(id, name));
  handle('koma:brand-kits:duplicate', ({ id }) => brandKits.duplicate(id));
  handle('koma:brand-kits:delete', ({ id }) => brandKits.remove(id));
  handle('koma:brand-kits:load', ({ id }) => brandKits.load(id));
  handle('koma:brand-kits:start-new', () => brandKits.startNew());

  return {
    cancel: async () => {
      await Promise.all([decks.cancel(), profiles.cancel()]);
    },
  };
}
