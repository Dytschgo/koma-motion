import type { KomaProject } from '@koma-motion/core';
import type {
  ExportDestination,
  ExporterAvailability,
  ExportResult,
  ExportValidationResult,
  PresentationExporter,
} from '../types';

const NOT_AVAILABLE_MESSAGE =
  'PowerPoint export is not available yet. It is planned, and the open questions are documented in docs/POWERPOINT_EXPORT_RESEARCH.md.';

/**
 * Placeholder for the planned PowerPoint exporter.
 *
 * It exists so that the exporter architecture is in place and tested. It
 * never writes a file: an empty or partial presentation would be misleading.
 */
export class PowerPointExporter implements PresentationExporter {
  readonly id = 'powerpoint';
  readonly displayName = 'PowerPoint';
  readonly fileExtension = 'pptx';
  readonly availability: ExporterAvailability = {
    status: 'unavailable',
    reason: NOT_AVAILABLE_MESSAGE,
  };

  validate(_project: KomaProject): Promise<ExportValidationResult> {
    return Promise.resolve({
      exportable: false,
      issues: [{ severity: 'error', code: 'exporterUnavailable', message: NOT_AVAILABLE_MESSAGE }],
    });
  }

  export(_project: KomaProject, _destination: ExportDestination): Promise<ExportResult> {
    return Promise.resolve({
      status: 'unsupported',
      feature: 'powerpoint-export',
      message: NOT_AVAILABLE_MESSAGE,
    });
  }
}
