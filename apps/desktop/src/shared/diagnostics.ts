/**
 * What the window may tell the diagnostics log about its own errors.
 *
 * The window holds the project, so the text of an error message never crosses
 * this boundary: a message can quote a value. The name of the error and where
 * it happened are enough to find the fault.
 */
import { z } from 'zod';

export const RENDERER_REPORT_KINDS = ['render', 'error', 'unhandled-rejection'] as const;

export const MAX_REPORT_NAME_LENGTH = 64;
export const MAX_REPORT_STACK_LENGTH = 4000;
const MAX_FRAME_LENGTH = 300;
const MAX_FRAMES = 40;

export const rendererReportSchema = z
  .object({
    kind: z.enum(RENDERER_REPORT_KINDS),
    /** The class of the error, for example `TypeError`. */
    name: z.string().max(MAX_REPORT_NAME_LENGTH),
    /** Stack frames without the message line. */
    stack: z.string().max(MAX_REPORT_STACK_LENGTH),
    /** Component names from React, when a component failed to render. */
    componentStack: z.string().max(MAX_REPORT_STACK_LENGTH),
  })
  .strict();
export type RendererReport = z.infer<typeof rendererReportSchema>;

/** A plain identifier, or `Error` when the name is anything else. */
export function errorName(name: unknown): string {
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_$]{0,63}$/.test(name) ? name : 'Error';
}

function collectFrames(text: unknown, isFrame: (line: string) => boolean): string {
  if (typeof text !== 'string') {
    return '';
  }
  const frames: string[] = [];
  let length = 0;
  for (const line of text.slice(0, 64 * 1024).split('\n')) {
    const frame = line.trim();
    if (!isFrame(line) || frame.length > MAX_FRAME_LENGTH) {
      continue;
    }
    if (frames.length === MAX_FRAMES || length + frame.length + 1 > MAX_REPORT_STACK_LENGTH) {
      break;
    }
    frames.push(frame);
    length += frame.length + 1;
  }
  return frames.join('\n');
}

/**
 * The call sites of a stack as the window reports them. The engine writes
 * each one as an indented `at …` line below the message. Every other line is
 * dropped: the message may span several lines and can quote a value.
 */
export function stackFrames(stack: unknown): string {
  return collectFrames(stack, (line) => line.startsWith('    at '));
}

/**
 * What the main process keeps of reported frames: lines that start with
 * `at `, within the same bounds. The window is not trusted to have filtered.
 */
export function acceptedFrames(frames: unknown): string {
  return collectFrames(frames, (line) => line.startsWith('at '));
}
