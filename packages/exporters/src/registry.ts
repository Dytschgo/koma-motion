import { PowerPointExporter } from './powerpoint/PowerPointExporter';
import type { PresentationExporter } from './types';

/** Every exporter known to Koma Motion, including those that are not available yet. */
export function createExporters(): PresentationExporter[] {
  return [new PowerPointExporter()];
}

/** The exporters that can produce files today. */
export function getAvailableExporters(
  exporters: readonly PresentationExporter[] = createExporters(),
): PresentationExporter[] {
  return exporters.filter((exporter) => exporter.availability.status === 'available');
}
