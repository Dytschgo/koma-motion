import { app } from 'electron';
import { unavailableImageAssetIds } from '../../services/imageValidation';
import { InstructionTemplateLibrary } from '../../services/instructionTemplates';
import { selectLogo } from '../../services/logo';
import { exportPowerPoint, validatePowerPoint } from '../../services/powerPointExport';
import {
  createNewProject,
  openProject,
  replaceOpenProject,
  saveProject,
  saveProjectAs,
} from '../../services/projectFiles';
import { selectReferenceFiles } from '../../services/referenceFiles';
import type { HandlerScope } from './scope';

// App scope, including across project/window replacement. Paths never come from the renderer.
const instructionTemplates = new InstructionTemplateLibrary(() => app.getPath('userData'));

/**
 * The open project: recovery, creating, opening and saving it, the files it
 * takes in, its export, and the instruction templates it can use.
 */
export function registerProjectHandlers({
  context,
  handle,
  cancelWork,
}: Pick<HandlerScope, 'context' | 'handle' | 'cancelWork'>): void {
  const { window, session } = context;

  handle('koma:recovery:offer', () => session.recovery?.offer() ?? { status: 'none' });
  handle(
    'koma:recovery:capture',
    (request) => session.recovery?.capture(request) ?? { status: 'stale' },
  );
  handle('koma:recovery:discard', async () => {
    try {
      await session.recovery?.discardPending();
      return { status: 'done' };
    } catch {
      return {
        status: 'failed',
        message: 'The recovery snapshot could not be discarded. Try again.',
      };
    }
  });
  handle('koma:recovery:restore', async () => {
    try {
      const record = await session.recovery?.restore();
      if (!record) return { status: 'failed', message: 'No recovery snapshot is available.' };
      replaceOpenProject(session);
      session.recoveredSourcePath = record.sourcePath;
      session.hasUnsavedChanges = true;
      cancelWork();
      context.projectStateChanged();
      return {
        status: 'recovered',
        project: record.project,
        recoverySessionId: record.sessionId,
        unavailableAssetIds: unavailableImageAssetIds(record.project.assets),
      };
    } catch {
      return {
        status: 'failed',
        message:
          'The recovery snapshot could not be restored. The original project was not changed.',
      };
    }
  });

  handle('koma:project:create', async ({ name }) => {
    await session.recovery?.assertResolved();
    cancelWork();
    const response = createNewProject(session, name, new Date());
    const recoverySessionId = await session.recovery?.activate(response.project, null);
    if (recoverySessionId) response.recoverySessionId = recoverySessionId;
    context.projectStateChanged();
    return response;
  });

  handle('koma:project:open', async () => {
    await session.recovery?.assertResolved();
    const response = await openProject(window, session);
    if (response.status === 'opened') {
      const recoverySessionId = await session.recovery?.activate(
        response.project,
        session.filePath,
      );
      if (recoverySessionId) response.recoverySessionId = recoverySessionId;
      cancelWork();
    }
    context.projectStateChanged();
    return response;
  });

  handle('koma:project:save', async ({ project }) => {
    const response = await saveProject(window, session, project, new Date());
    context.projectStateChanged();
    return response;
  });

  handle('koma:project:save-as', async ({ project, preserveOriginal }) => {
    const response = await saveProjectAs(
      window,
      session,
      project,
      new Date(),
      session.sessionId,
      preserveOriginal,
    );
    context.projectStateChanged();
    return response;
  });

  handle('koma:references:select', () => selectReferenceFiles(window));
  handle('koma:project:select-image', () => selectLogo(window, 'Choose an image'));
  handle('koma:export:validate', ({ project }) => validatePowerPoint(project));
  handle('koma:export:powerpoint', ({ project, options }) =>
    exportPowerPoint(window, project, options, () => session.sessionId),
  );

  handle('koma:instruction-templates:list', async () => {
    try {
      return { status: 'loaded', templates: await instructionTemplates.list() };
    } catch {
      return {
        status: 'failed',
        message:
          'The template library could not be loaded. Your saved templates have not been changed. Retry after checking the app data folder.',
      };
    }
  });

  handle('koma:instruction-templates:change', async (action) => {
    try {
      return { status: 'saved', templates: await instructionTemplates.change(action) };
    } catch {
      return {
        status: 'failed',
        message:
          'The template could not be saved. Your input has been kept. Reload the library and try again; check its limit of 100 templates and access to the app data folder.',
      };
    }
  });
}
