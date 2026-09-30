import { systemInstructionsSchema } from '@koma-motion/core';
import { z } from 'zod';

export const MAX_INSTRUCTION_TEMPLATES = 100;
export const templateNameSchema = z.string().trim().min(1).max(100);
export const templateIdSchema = z.uuid();
export const instructionTemplateSchema = z
  .object({
    id: templateIdSchema,
    name: templateNameSchema,
    instructions: systemInstructionsSchema,
  })
  .strict();
export type InstructionTemplate = z.infer<typeof instructionTemplateSchema>;

export const instructionTemplateLibrarySchema = z
  .object({
    version: z.literal(1),
    templates: z.array(instructionTemplateSchema).max(MAX_INSTRUCTION_TEMPLATES),
  })
  .strict()
  .superRefine((library, context) => {
    if (
      new Set(library.templates.map((template) => template.id)).size !== library.templates.length
    ) {
      context.addIssue({ code: 'custom', message: 'Template ids must be unique.' });
    }
  });

export const instructionTemplateActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      name: templateNameSchema,
      instructions: systemInstructionsSchema,
    })
    .strict(),
  z
    .object({ action: z.literal('rename'), id: templateIdSchema, name: templateNameSchema })
    .strict(),
  z
    .object({ action: z.literal('duplicate'), id: templateIdSchema, name: templateNameSchema })
    .strict(),
  z.object({ action: z.literal('delete'), id: templateIdSchema }).strict(),
]);
export type InstructionTemplateAction = z.infer<typeof instructionTemplateActionSchema>;
