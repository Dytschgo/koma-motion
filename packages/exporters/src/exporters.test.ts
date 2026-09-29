import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProject } from '@koma-motion/core/testing';
import { describe, expect, it } from 'vitest';
import { PowerPointExporter } from './powerpoint/PowerPointExporter';
import { createExporters, getAvailableExporters } from './registry';

describe('PowerPointExporter', () => {
  const exporter = new PowerPointExporter();

  it('states that it is not available', async () => {
    expect(exporter.availability.status).toBe('unavailable');
    const validation = await exporter.validate(buildProject());
    expect(validation.exportable).toBe(false);
    expect(validation.issues[0]?.message).toContain('not available yet');
  });

  it('returns a typed unsupported result and writes nothing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'koma-export-'));
    try {
      const result = await exporter.export(buildProject(), {
        filePath: join(directory, 'presentation.pptx'),
      });
      expect(result).toMatchObject({ status: 'unsupported', feature: 'powerpoint-export' });
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('exporter registry', () => {
  it('knows the PowerPoint exporter but does not offer it as available', () => {
    expect(createExporters().map((exporter) => exporter.id)).toEqual(['powerpoint']);
    expect(getAvailableExporters()).toEqual([]);
  });
});
