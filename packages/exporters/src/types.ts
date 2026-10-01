import type { KomaProject } from '@koma-motion/core';

/**
 * Exporters read the document model and write another format. They never add
 * concepts of their target format to the document model.
 */
export interface PresentationExporter {
  readonly id: string;
  readonly displayName: string;
  /** File extension of the exported document, without the dot. */
  readonly fileExtension: string;
  /** Whether the exporter can produce files. Only available exporters appear as usable in the application. */
  readonly availability: ExporterAvailability;

  validate(project: KomaProject): Promise<ExportValidationResult>;

  export(project: KomaProject, destination: ExportDestination): Promise<ExportResult>;
}

export type ExporterAvailability =
  { readonly status: 'available' } | { readonly status: 'unavailable'; readonly reason: string };

/**
 * Where an export is written. The application chooses the path through a
 * native dialog in the main process; exporters never choose paths themselves.
 */
export interface ExportDestination {
  readonly filePath: string;
  /** Static slides by default. Motion is an approximation of Koma transitions. */
  readonly motion?: 'static' | 'fade' | 'morph';
  /** Advance automatically after each transition when motion is requested. */
  readonly autoAdvance?: boolean;
}

export type ExportIssueSeverity = 'error' | 'warning';

export interface ExportIssue {
  readonly severity: ExportIssueSeverity;
  readonly code: string;
  /** A sentence that can be shown to the user as it is. */
  readonly message: string;
}

export interface ExportValidationResult {
  /** `false` when the project cannot be exported by this exporter. */
  readonly exportable: boolean;
  readonly issues: readonly ExportIssue[];
}

export type ExportResult =
  | {
      readonly status: 'exported';
      readonly filePath: string;
      readonly warnings: readonly ExportIssue[];
    }
  | {
      /** The exporter or one of its features does not exist yet. Nothing was written. */
      readonly status: 'unsupported';
      readonly feature: string;
      readonly message: string;
    }
  | {
      readonly status: 'failed';
      readonly message: string;
      readonly issues: readonly ExportIssue[];
    };
