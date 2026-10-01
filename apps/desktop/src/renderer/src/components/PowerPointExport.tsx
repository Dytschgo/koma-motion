import { useState, type ReactElement } from 'react';
import type { KomaProject } from '@koma-motion/core';
import {
  powerPointOptionsSchema,
  type ExportValidation,
  type PowerPointOptions,
} from '../../../shared/export';
import { invoke } from '../lib/api';
import { selectProject, useProjectStore } from '../state/projectStore';
import { DownloadIcon } from './icons';
import { Button, Modal, Select } from './ui';

/** This control is keyed by project session, so a replacement closes its dialog. */
export function PowerPointExport(): ReactElement {
  const project = useProjectStore(selectProject);
  const [snapshot, setSnapshot] = useState<KomaProject | null>(null);
  const [validation, setValidation] = useState<ExportValidation | null>(null);
  const [options, setOptions] = useState<PowerPointOptions>({
    motion: 'static',
    autoAdvance: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<readonly string[]>([]);

  const open = async (): Promise<void> => {
    if (project === null) return;
    const session = useProjectStore.getState().sessionId;
    setSnapshot(project);
    setValidation(null);
    setError(null);
    setSaved(null);
    setWarnings([]);
    setBusy(true);
    try {
      const result = await invoke('koma:export:validate', { project });
      if (useProjectStore.getState().sessionId === session) setValidation(result);
    } catch {
      if (useProjectStore.getState().sessionId === session)
        setError('The presentation could not be checked. Close this dialog and try again.');
    } finally {
      if (useProjectStore.getState().sessionId === session) setBusy(false);
    }
  };

  const save = async (): Promise<void> => {
    if (snapshot === null || busy || validation?.exportable !== true) return;
    const session = useProjectStore.getState().sessionId;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await invoke('koma:export:powerpoint', { project: snapshot, options });
      if (useProjectStore.getState().sessionId !== session) return;
      if (result.status === 'failed') setError(result.message);
      if (result.status === 'exported') {
        setSaved(result.fileName);
        setWarnings(result.warnings.map((issue) => issue.message));
      }
    } catch {
      if (useProjectStore.getState().sessionId === session)
        setError('Export failed. Your Koma project has not changed. Try another destination.');
    } finally {
      if (useProjectStore.getState().sessionId === session) setBusy(false);
    }
  };

  return (
    <>
      <Button
        compact
        icon={<DownloadIcon size={14} />}
        disabled={project === null || project.presentation.komas.length === 0}
        onClick={() => void open()}
      >
        Export
      </Button>
      <Modal
        title="Export PowerPoint"
        open={snapshot !== null}
        onClose={() => {
          if (!busy) setSnapshot(null);
        }}
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setSnapshot(null)}>
              Close
            </Button>
            <Button
              variant="primary"
              disabled={busy || validation?.exportable !== true}
              onClick={() => void save()}
            >
              {busy ? 'Preparing…' : 'Choose destination'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p>
            Export {snapshot?.presentation.komas.length ?? 0} Komas as editable PowerPoint slides.
            This exports the project as it was when you opened this dialog.
          </p>
          <label className="flex flex-col gap-1.5">
            Motion
            <Select
              value={options.motion}
              disabled={busy}
              onChange={(event) => {
                const parsed = powerPointOptionsSchema.safeParse({
                  ...options,
                  motion: event.target.value,
                });
                if (parsed.success)
                  setOptions({
                    ...parsed.data,
                    autoAdvance: parsed.data.motion !== 'static' && options.autoAdvance,
                  });
              }}
            >
              <option value="static">Static slides</option>
              <option value="fade">Fade between slides</option>
              <option value="morph">Morph matching objects</option>
            </Select>
          </label>
          <p className="text-sm text-ink-400">
            PowerPoint may render fonts and motion differently. Morph requires a PowerPoint version
            that supports it. Koma's staged choreography and easing cannot be reproduced exactly.
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={options.autoAdvance}
              disabled={busy || options.motion === 'static'}
              onChange={(event) => setOptions({ ...options, autoAdvance: event.target.checked })}
            />
            <span>Advance automatically using transition timing</span>
          </label>
          <p className="text-sm text-ink-400">
            References attached in chat stay in this session and are not included in this file.
          </p>
          {validation?.issues.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {validation.issues.map((issue, index) => (
                <li
                  key={index}
                  className={issue.severity === 'error' ? 'text-motion' : 'text-signal-warn'}
                >
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
          {error !== null && (
            <p role="alert" className="text-motion">
              {error}
            </p>
          )}
          {saved !== null && (
            <p role="status" className="text-signal-ok">
              Exported {saved}. Your Koma project is unchanged.
            </p>
          )}
          {warnings.length > 0 && (
            <ul
              aria-label="Export warnings"
              className="list-disc space-y-1 pl-5 text-sm text-signal-warn"
            >
              {warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
}
