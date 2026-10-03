import { collectAssetWarnings } from './assetHealth';
import { type KomaProject, type ProjectWarning } from '@koma-motion/core';
import { validateTransition } from '@koma-motion/motion-engine';

export interface HealthIssue {
  readonly id: string;
  readonly severity: 'blocked' | 'problem' | 'info';
  readonly message: string;
  readonly repair?: ProjectWarning;
}

export function collectHealthIssues(
  project: KomaProject | null,
  loadWarnings: readonly string[],
  migratedFrom: number | null,
): HealthIssue[] {
  if (project === null) return [];
  const issues: HealthIssue[] = collectAssetWarnings(project).map((repair) => ({
    id: repair.id,
    severity: 'problem',
    message: repair.message,
    repair,
  }));
  if (migratedFrom !== null)
    issues.push({
      id: 'migration',
      severity: 'info',
      message: `Project upgraded from format version ${String(migratedFrom)} to ${String(project.schemaVersion)}. Saving writes the current format (version ${String(project.schemaVersion)}). Save a copy to keep the older file.`,
    });
  for (const message of new Set(loadWarnings))
    issues.push({
      id: `load:${message}`,
      severity: 'info',
      message,
    });
  for (const transition of project.presentation.transitions) {
    const index = project.presentation.komas.findIndex((koma) => koma.id === transition.fromKomaId);
    for (const [message, issue] of new Map(
      validateTransition(transition, project.presentation).map((issue) => [issue.message, issue]),
    )) {
      const partial = issue.code === 'unsupportedOperation';
      issues.push({
        id: `motion:${transition.id}:${message}`,
        severity: partial ? 'info' : 'blocked',
        message: `Motion from Koma ${String(index + 1)}: ${message} ${partial ? 'This effect is skipped; supported motion can still play.' : 'Interpolation is blocked; the real endpoint frames remain available.'}`,
      });
    }
  }
  return issues;
}
