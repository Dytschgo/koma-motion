import { randomUUID } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '@koma-motion/project-format/node';
import {
  instructionTemplateActionSchema,
  instructionTemplateLibrarySchema,
  type InstructionTemplate,
  type InstructionTemplateAction,
} from '../../shared/instructionTemplates';

export const INSTRUCTION_TEMPLATES_FILE = 'instruction-templates.json';
// 100 templates of up to 8000 code units, including worst-case JSON escaping.
export const MAX_TEMPLATE_LIBRARY_BYTES = 5 * 1024 * 1024;

/** Main-process-only library. Reads and mutations share a queue to avoid lost updates. */
export class InstructionTemplateLibrary {
  readonly #directory: () => string;
  readonly #write: typeof writeFileAtomic;
  #pending: Promise<unknown> = Promise.resolve();

  constructor(directory: () => string, write: typeof writeFileAtomic = writeFileAtomic) {
    this.#directory = directory;
    this.#write = write;
  }

  #enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#pending.then(work);
    this.#pending = next.catch(() => undefined);
    return next;
  }

  async #read(): Promise<InstructionTemplate[]> {
    const path = join(this.#directory(), INSTRUCTION_TEMPLATES_FILE);
    let handle;
    try {
      handle = await open(path, 'r');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    try {
      const details = await handle.stat();
      if (!details.isFile() || details.size > MAX_TEMPLATE_LIBRARY_BYTES) {
        throw new Error('Invalid template library.');
      }
      // Bounded read even if another process grows the file after stat.
      const buffer = Buffer.alloc(MAX_TEMPLATE_LIBRARY_BYTES + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
        if (chunk.bytesRead === 0) break;
        bytesRead += chunk.bytesRead;
      }
      if (bytesRead > MAX_TEMPLATE_LIBRARY_BYTES) {
        throw new Error('Template library is too large.');
      }
      const data: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
      return instructionTemplateLibrarySchema.parse(data).templates;
    } finally {
      await handle.close();
    }
  }

  list(): Promise<InstructionTemplate[]> {
    return this.#enqueue(() => this.#read());
  }

  change(action: InstructionTemplateAction): Promise<InstructionTemplate[]> {
    return this.#enqueue(async () => {
      const validated = instructionTemplateActionSchema.parse(action);
      const templates = await this.#read();
      let next: InstructionTemplate[];
      if (validated.action === 'create') {
        next = [
          ...templates,
          { id: randomUUID(), name: validated.name, instructions: validated.instructions },
        ];
      } else {
        const source = templates.find((template) => template.id === validated.id);
        if (source === undefined) {
          throw new Error('This template no longer exists. Reload the library.');
        }
        switch (validated.action) {
          case 'rename':
            next = templates.map((template) =>
              template.id === source.id ? { ...template, name: validated.name } : template,
            );
            break;
          case 'duplicate':
            next = [...templates, { ...source, id: randomUUID(), name: validated.name }];
            break;
          case 'delete':
            next = templates.filter((template) => template.id !== source.id);
            break;
        }
      }
      const library = instructionTemplateLibrarySchema.parse({ version: 1, templates: next });
      const text = `${JSON.stringify(library, null, 2)}\n`;
      if (Buffer.byteLength(text, 'utf8') > MAX_TEMPLATE_LIBRARY_BYTES) {
        throw new Error('Template library is too large.');
      }
      await mkdir(this.#directory(), { recursive: true });
      await this.#write(join(this.#directory(), INSTRUCTION_TEMPLATES_FILE), text);
      return library.templates;
    });
  }
}
