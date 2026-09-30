import {
  MAX_SYSTEM_INSTRUCTIONS_LENGTH,
  systemInstructionsSchema,
  type KomaProject,
} from '@koma-motion/core';
import { useEffect, useState, type ReactElement } from 'react';
import {
  MAX_INSTRUCTION_TEMPLATES,
  templateNameSchema,
  type InstructionTemplate,
  type InstructionTemplateAction,
} from '../../../shared/instructionTemplates';
import { invoke } from '../lib/api';
import { changeSystemInstructions } from '../state/commands';
import { useProjectStore } from '../state/projectStore';
import { Button, Field, Select, SettingsCard, TextArea, TextInput } from './ui';

const LIMIT_HINT = `Up to ${String(MAX_SYSTEM_INSTRUCTIONS_LENGTH)} characters. Text is never shortened automatically.`;

/** Shown on project pages while no project is open. */
export function NoProject(): ReactElement {
  return (
    <div className="rounded-card border border-dashed border-line-strong px-5 py-8 text-center">
      <p className="font-medium text-ink-100">No project is open</p>
      <p className="mt-1 text-sm text-ink-400">
        These settings are stored in a project. Create or open a project to change them.
      </p>
    </div>
  );
}

/**
 * The project instructions page and the app template library page. Called by
 * SettingsDialog, which stays mounted, so unfinished input survives closing
 * and reopening Settings and switching between its pages.
 */
export function useInstructionSettings(
  project: KomaProject | null,
  open: boolean,
): { readonly projectPage: ReactElement; readonly libraryPage: ReactElement } {
  const sessionId = useProjectStore((state) => state.sessionId);
  const apply = useProjectStore((state) => state.apply);
  const [draft, setDraft] = useState<{ sessionId: number; text: string } | null>(null);
  const [templates, setTemplates] = useState<InstructionTemplate[] | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [rename, setRename] = useState('');
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageSession, setMessageSession] = useState<number | null>(null);
  const [error, setError] = useState('');
  const text = draft?.sessionId === sessionId ? draft.text : (project?.systemInstructions ?? '');
  const parsed = systemInstructionsSchema.safeParse(text);
  const templateParsed = systemInstructionsSchema.safeParse(instructions);
  const selected = templates?.find((template) => template.id === selectedId);

  const load = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const response = await invoke('koma:instruction-templates:list', {});
      if (response.status === 'failed') {
        setError(response.message);
      } else {
        setTemplates(response.templates);
      }
    } catch {
      setError('The template library could not be loaded. Your input has been kept. Try again.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    invoke('koma:instruction-templates:list', {}).then(
      (response) => {
        if (!active) return;
        if (response.status === 'loaded') {
          setTemplates(response.templates);
          setError('');
        } else setError(response.message);
      },
      () => {
        if (active)
          setError(
            'The template library could not be loaded. Your input has been kept. Try again.',
          );
      },
    );
    return () => {
      active = false;
    };
  }, [open]);

  const change = async (action: InstructionTemplateAction): Promise<void> => {
    setBusy(true);
    setError('');
    setMessage('');
    setMessageSession(null);
    try {
      const response = await invoke('koma:instruction-templates:change', action);
      if (response.status === 'failed') {
        setError(response.message);
      } else {
        setTemplates(response.templates);
        setMessage('Template library saved in this app. Project instructions were not changed.');
        if (action.action === 'delete') setSelectedId('');
      }
    } catch {
      setError('The template could not be saved. Your input has been kept. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const feedback = (
    <>
      {error !== '' && (
        <p role="alert" className="text-pencil-red">
          {error}
        </p>
      )}
      {message !== '' && (messageSession === null || messageSession === sessionId) && (
        <p role="status" className="text-ink-300">
          {message}
        </p>
      )}
    </>
  );

  const projectPage =
    project === null ? (
      <NoProject />
    ) : (
      <SettingsCard
        title="System instructions"
        description={
          project.systemInstructions.trim() === ''
            ? 'No active project instructions. Default presentation rules apply.'
            : 'Project instructions are active. Save the project to keep them in its file.'
        }
      >
        <Field
          label="Project system instructions"
          hint={`Included in each agent request. Edits can be undone. ${LIMIT_HINT}`}
          error={parsed.success ? undefined : parsed.error.issues[0]?.message}
        >
          {(ids) => (
            <TextArea
              {...ids}
              rows={8}
              value={text}
              placeholder="For example: use concise language and explain technical terms. Leave empty for the default behavior."
              onChange={(event) => {
                const next = event.target.value;
                if (systemInstructionsSchema.safeParse(next).success) {
                  apply(changeSystemInstructions(next), { coalesceKey: 'project-instructions' });
                  setDraft(null);
                } else {
                  setDraft({ sessionId, text: next });
                }
              }}
            />
          )}
        </Field>
        {!parsed.success && (
          <p className="mt-2 text-sm text-signal-warn">
            This draft is too long. Shorten it to update the project; requests and saves still use
            the last valid instructions.
          </p>
        )}
        <p className="mt-3 text-sm text-ink-400">
          Instructions guide presentation content; provider permissions stay fixed. To reuse text
          across projects, save it under Templates.
        </p>
        {message !== '' && messageSession === sessionId && (
          <p role="status" className="mt-2 text-ink-300">
            {message}
          </p>
        )}
      </SettingsCard>
    );

  const libraryPage = (
    <div className="flex flex-col gap-4">
      <SettingsCard
        title="Saved templates"
        description="Available across projects for this app user. Applying a template copies its text into the open project; later template changes do not change projects."
        action={
          <Button variant="outline" compact disabled={busy} onClick={() => void load()}>
            Reload templates
          </Button>
        }
      >
        {templates === null ? (
          <p role="status" className="text-ink-300">
            {error === '' ? 'Loading template library…' : 'Template library unavailable.'}
          </p>
        ) : templates.length === 0 ? (
          <p className="text-ink-300">No saved templates yet. Save your first template below.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="Saved instruction template">
              {(ids) => (
                <Select
                  {...ids}
                  value={selectedId}
                  disabled={busy}
                  onChange={(event) => {
                    setSelectedId(event.target.value);
                    setRename(
                      templates.find((template) => template.id === event.target.value)?.name ?? '',
                    );
                    setMessage('');
                  }}
                >
                  <option value="">Select a template</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {selected !== undefined && (
              <>
                <Field label="Saved template instructions">
                  {(ids) => <TextArea {...ids} rows={3} readOnly value={selected.instructions} />}
                </Field>
                <Field
                  label="Template name"
                  error={
                    templateNameSchema.safeParse(rename).success
                      ? undefined
                      : 'Use a name of 1–100 characters.'
                  }
                >
                  {(ids) => (
                    <TextInput
                      {...ids}
                      value={rename}
                      onChange={(event) => setRename(event.target.value)}
                    />
                  )}
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    disabled={project === null || busy || !parsed.success}
                    title={project === null ? 'Open a project to apply a template' : undefined}
                    onClick={() => {
                      apply(changeSystemInstructions(selected.instructions));
                      setDraft(null);
                      setMessageSession(sessionId);
                      setMessage(
                        'Template applied to this project. Save the project to keep it. You can undo this change.',
                      );
                    }}
                  >
                    Apply to project
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || !templateNameSchema.safeParse(rename).success}
                    onClick={() => void change({ action: 'rename', id: selected.id, name: rename })}
                  >
                    Rename template
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      busy ||
                      templates.length >= MAX_INSTRUCTION_TEMPLATES ||
                      !templateNameSchema.safeParse(rename).success
                    }
                    onClick={() =>
                      void change({ action: 'duplicate', id: selected.id, name: rename })
                    }
                  >
                    Duplicate template
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void change({ action: 'delete', id: selected.id })}
                  >
                    Delete template
                  </Button>
                </div>
                <p className="text-sm text-ink-400">
                  Rename or duplicate uses the name above. Deleting a template leaves applied
                  project instructions in place.
                </p>
              </>
            )}
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title="Create an app template"
        description="Up to 100 templates. To revise instructions, create a new template from edited text."
      >
        <div className="flex flex-col gap-3">
          <Field
            label="New template name"
            hint="1–100 characters."
            error={
              name !== '' && !templateNameSchema.safeParse(name).success
                ? 'Use a name of 1–100 characters.'
                : undefined
            }
          >
            {(ids) => (
              <TextInput {...ids} value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </Field>
          <Field
            label="New template instructions"
            hint={LIMIT_HINT}
            error={templateParsed.success ? undefined : templateParsed.error.issues[0]?.message}
          >
            {(ids) => (
              <TextArea
                {...ids}
                rows={4}
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={project === null || busy}
              onClick={() => setInstructions(text)}
            >
              Copy project text into template draft
            </Button>
            <Button
              variant="primary"
              disabled={
                templates === null ||
                templates.length >= MAX_INSTRUCTION_TEMPLATES ||
                busy ||
                !templateParsed.success ||
                !templateNameSchema.safeParse(name).success
              }
              onClick={() => void change({ action: 'create', name, instructions })}
            >
              Save new template
            </Button>
          </div>
          {templates !== null && templates.length >= MAX_INSTRUCTION_TEMPLATES && (
            <p className="text-sm text-signal-warn">
              The library is full. Delete a template before saving or duplicating another.
            </p>
          )}
        </div>
      </SettingsCard>
      {feedback}
    </div>
  );

  return { projectPage, libraryPage };
}
