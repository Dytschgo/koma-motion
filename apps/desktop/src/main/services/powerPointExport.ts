import { basename, extname } from 'node:path';
import type { KomaProject } from '@koma-motion/core';
import { PowerPointExporter } from '@koma-motion/exporters';
import { dialog, type BrowserWindow } from 'electron';
import type { PowerPointOptions } from '../../shared/export';
import type { IpcResponse } from '../../shared/ipc';

export async function validatePowerPoint(
  project: KomaProject,
): Promise<IpcResponse<'koma:export:validate'>> {
  const result = await new PowerPointExporter().validate(project);
  return { exportable: result.exportable, issues: [...result.issues] };
}

/** Export a snapshot; a native dialog is the only source of its destination. */
export async function exportPowerPoint(
  window: BrowserWindow,
  project: KomaProject,
  options: PowerPointOptions,
  currentSession: () => number,
): Promise<IpcResponse<'koma:export:powerpoint'>> {
  const sessionId = currentSession();
  try {
    const exporter = new PowerPointExporter();
    const validation = await exporter.validate(project);
    if (!validation.exportable) {
      return {
        status: 'failed',
        message: validation.issues.map((issue) => issue.message).join('\n'),
      };
    }
    const selection = await dialog.showSaveDialog(window, {
      title: 'Export PowerPoint',
      defaultPath: `${project.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120) || 'Presentation'}.pptx`,
      filters: [{ name: 'PowerPoint presentation', extensions: ['pptx'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (selection.canceled || selection.filePath === undefined) return { status: 'cancelled' };
    if (currentSession() !== sessionId) {
      return {
        status: 'failed',
        message:
          'The project changed while choosing the export destination. Export the current project again.',
      };
    }
    if (extname(selection.filePath).toLowerCase() !== '.pptx') {
      return { status: 'failed', message: 'Choose a destination ending in .pptx.' };
    }
    const result = await exporter.export(project, { filePath: selection.filePath, ...options });
    return result.status === 'exported'
      ? { status: 'exported', fileName: basename(result.filePath), warnings: [...result.warnings] }
      : { status: 'failed', message: result.message };
  } catch {
    return {
      status: 'failed',
      message: 'The presentation could not be exported. Check the destination and try again.',
    };
  }
}
