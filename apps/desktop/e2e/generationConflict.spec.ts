import { join } from 'node:path';
import {
  agentError,
  buildGenerationRequest,
  buildMockResponse,
  convertResponseToPresentation,
} from '@koma-motion/agent-runtime';
import { createSeededIdGenerator, komaProjectSchema } from '@koma-motion/core';
import { expect, test } from '@playwright/test';
import { ipcContract, type GenerationOutcome, type IpcRequest } from '../src/shared/ipc';
import {
  isWideWindow,
  launchApplication,
  showChat,
  showInspector,
  type RunningApplication,
} from './application';

let running: RunningApplication;
let heldGeneration: Awaited<ReturnType<typeof holdGeneration>>;

const requestText = 'Create three Komas about the motion engine.';
const timestamp = '2026-10-03T12:00:00.000Z';
const diagnostics = {
  providerId: 'mock',
  startedAt: timestamp,
  finishedAt: timestamp,
  durationMs: 0,
  promptTemplate: 'presentation-generation@1',
  attempts: [],
};

/** This spec tests renderer conflict decisions, with a test-only held IPC reply. */
async function holdGeneration() {
  const cancelled = ipcContract['koma:providers:execute'].response.parse({
    status: 'cancelled',
    error: agentError('cancelled', 'The test ended before releasing its reply.'),
    historyEntry: {
      id: 'held-generation',
      createdAt: timestamp,
      providerId: 'mock',
      userRequest: requestText,
      status: 'cancelled',
      summary: 'Test teardown',
      warnings: [],
    },
    diagnostics,
  });
  return running.application.evaluateHandle(({ ipcMain }, fallback) => {
    let request: unknown = null;
    let resolveReply: ((reply: unknown) => void) | null = null;
    let received = false;
    ipcMain.removeHandler('koma:providers:execute');
    ipcMain.handle('koma:providers:execute', (_event, incoming: unknown) => {
      if (received) throw new Error('The held generation fixture accepts exactly one request.');
      received = true;
      request = incoming;
      return new Promise<unknown>((resolve) => {
        resolveReply = resolve;
      });
    });
    return {
      received: () => received,
      request: () => request,
      release(reply: unknown) {
        if (resolveReply === null) throw new Error('There is no held generation to release.');
        resolveReply(reply);
        resolveReply = null;
      },
      dispose() {
        resolveReply?.(fallback);
        resolveReply = null;
        ipcMain.removeHandler('koma:providers:execute');
      },
    };
  }, cancelled);
}

/** Use the real mock story and converter, then validate the entire IPC fixture. */
function generationReply(captured: IpcRequest<'koma:providers:execute'>): GenerationOutcome {
  const request = buildGenerationRequest(komaProjectSchema.parse(captured.project), captured.input);
  const converted = convertResponseToPresentation(buildMockResponse(request), {
    request,
    idGenerator: createSeededIdGenerator('generation-conflict-fixture'),
  });
  if (!converted.ok) throw new Error(converted.error.message);
  expect(converted.value.presentation.komas).toHaveLength(3);
  return ipcContract['koma:providers:execute'].response.parse({
    status: 'succeeded',
    presentation: converted.value.presentation,
    historyEntry: {
      id: 'held-generation',
      createdAt: timestamp,
      providerId: 'mock',
      userRequest: requestText,
      status: 'succeeded',
      summary: 'Created 3 Komas',
      warnings: [],
    },
    warnings: converted.value.warnings,
    repaired: false,
    diagnostics,
  });
}

test.beforeEach(async () => {
  running = await launchApplication();
  heldGeneration = await holdGeneration();
});

test.afterEach(async () => {
  try {
    await heldGeneration?.evaluate((gate) => gate.dispose());
  } finally {
    await running.close();
  }
});

async function completeGenerationWithEdits(): Promise<void> {
  const { window } = running;
  await window.getByRole('button', { name: 'Create a project' }).click();
  await window.getByLabel('Your request').fill(requestText);
  await window.getByRole('button', { name: 'Generate Komas' }).click();
  await expect.poll(() => heldGeneration.evaluate((gate) => gate.received())).toBe(true);
  const captured = ipcContract['koma:providers:execute'].request.parse(
    await heldGeneration.evaluate((gate) => gate.request()),
  );
  expect(captured.providerId).toBe('mock');
  expect(captured.input.userRequest).toBe(requestText);
  expect(captured.input.targetKomaId).toBeUndefined();
  expect(captured.project.presentation.komas).toHaveLength(0);
  await window.getByRole('button', { name: 'Add Koma' }).click();
  await showInspector(window);
  await window.getByLabel('Title', { exact: true }).fill('My work in progress');
  // The strip reads project state: input text alone would not prove the edit committed.
  await expect(
    window.getByRole('button', { name: 'Koma 1: My work in progress', exact: true }),
  ).toBeVisible();
  await expect(window.getByRole('dialog', { name: 'Replace your edited Komas?' })).toHaveCount(0);
  await heldGeneration.evaluate((gate, reply) => gate.release(reply), generationReply(captured));
  await expect(window.getByRole('dialog', { name: 'Replace your edited Komas?' })).toBeVisible();
  // A narrow window hides the chat to show the Inspector, and the dialog keeps it hidden.
  if (await isWideWindow(window)) {
    await expect(window.getByText('Generation complete. Waiting for your decision')).toBeVisible();
  }
}

test('keeps edits when a completed generation is declined', async () => {
  const { window, problems } = running;
  // Exercise the Inspector/chat switch that exposed the race on hosted macOS.
  await running.application.evaluate(({ BrowserWindow }) => {
    const native = BrowserWindow.getAllWindows()[0];
    native?.setMinimumSize(800, 600);
    native?.setContentSize(1024, 700);
  });
  await expect.poll(() => isWideWindow(window)).toBe(false);
  await completeGenerationWithEdits();
  const dialog = window.getByRole('dialog', { name: 'Replace your edited Komas?' });
  await expect(dialog).toContainText('Keep editing discards the generated Komas.');
  const evidenceDirectory = process.env['KOMA_EVIDENCE_DIR'];
  if (evidenceDirectory !== undefined) {
    await window.screenshot({ path: join(evidenceDirectory, 'generation-conflict.png') });
  }
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await showChat(window);
  await expect(
    window.getByRole('button', { name: 'Koma 1: My work in progress', exact: true }),
  ).toBeVisible();
  await expect(window.getByText('Generated Komas were not applied')).toBeVisible();
  await expect(window.getByText('Your edits remain in the presentation.')).toBeVisible();
  expect(problems).toEqual([]);
});

test('replaces edits only after explicit confirmation and can undo back to them', async () => {
  const { window, problems } = running;
  await completeGenerationWithEdits();
  await window
    .getByRole('dialog', { name: 'Replace your edited Komas?' })
    .getByRole('button', { name: 'Replace Komas' })
    .click();
  await showChat(window);
  await expect(
    window.getByRole('list', { name: 'Komas' }).getByRole('button', { name: /^Koma \d:/ }),
  ).toHaveCount(3);
  await expect(window.getByText(/Created 3 Komas/)).toBeVisible();
  await window.getByRole('button', { name: 'Undo' }).click();
  await expect(
    window.getByRole('button', { name: 'Koma 1: My work in progress', exact: true }),
  ).toBeVisible();
  expect(problems).toEqual([]);
});
