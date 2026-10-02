import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { createNewProject } from '../lib/projectActions';
import type { SettingsPageId } from '../lib/settingsPages';
import { selectProject, useProjectStore } from '../state/projectStore';
import { useQuickStartStore } from '../state/quickStartStore';
import { useUiStore } from '../state/uiStore';
import { CloseIcon } from './icons';
import { Badge, Button, IconButton, ModalFrame, choiceRowClass } from './ui';

const STEPS = ['Start', 'Brand Kit', 'Instructions', 'Generate', 'Edit & repair', 'Play', 'Export'];

/** An on-demand guide. Following a link closes it; reopening keeps your place. */
export function QuickStartGuide(): ReactElement {
  const { open, completed, setOpen, setCompleted } = useQuickStartStore();
  const project = useProjectStore(selectProject);
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const close = (): void => setOpen(false);

  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open, step]);

  // Wait for the native dialog to close and the destination to render before
  // focusing it. This also prevents focus returning to a hidden guide link.
  const visit = (action: () => void, target?: string): void => {
    close();
    requestAnimationFrame(() => {
      action();
      if (target !== undefined) {
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>(target)?.focus();
        });
      }
    });
  };
  const settings = (page: SettingsPageId): void =>
    visit(() => useUiStore.getState().openSettings(page));
  const brandKit = (library: boolean): void =>
    visit(() => {
      const ui = useUiStore.getState();
      ui.setAgentPanelOpen(false);
      ui.setBrandKitTab(library ? 'library' : 'project');
      ui.setView('brandKit');
    }, '[aria-label="Brand Kit"] [role="tab"][aria-selected="true"]');
  const canvas = (motion: boolean): void =>
    visit(
      () => {
        const ui = useUiStore.getState();
        ui.stopPreview();
        ui.setView('canvas');
        ui.setAgentPanelOpen(false);
        ui.setInspectorTab(motion ? 'motion' : 'koma');
      },
      motion ? '[data-tab="motion"]' : '[data-guide-target="canvas"]',
    );

  return (
    <ModalFrame open={open} onClose={close} labelledBy={titleId} className="w-[760px]">
      <div className="flex max-h-[85vh] flex-col">
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={titleId} className="text-xl font-semibold tracking-tight">
                Getting started
              </h2>
              {completed && <Badge tone="ok">Completed</Badge>}
            </div>
            <p className="mt-1 text-sm text-ink-300">
              A quick guide to your first presentation. Reopen it anytime from Getting started.
            </p>
          </div>
          <IconButton label="Close getting started" onClick={close}>
            <CloseIcon />
          </IconButton>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <nav aria-label="Quick-start steps" className="mb-5 flex flex-wrap gap-1">
            {STEPS.map((label, index) => (
              <button
                key={label}
                type="button"
                aria-current={step === index ? 'step' : undefined}
                className={`px-3 py-2 text-sm ${choiceRowClass(step === index)}`}
                onClick={() => setStep(index)}
              >
                {index + 1}. {label}
              </button>
            ))}
          </nav>
          <h3 ref={heading} tabIndex={-1} className="mb-3 text-lg font-semibold tracking-tight">
            {step + 1}. {STEPS[step]}
          </h3>
          <div className="space-y-3 leading-relaxed text-ink-300 [&_strong]:font-semibold [&_strong]:text-ink-100">
            {step === 0 && (
              <>
                <p>
                  Each frame is a <strong>Koma</strong>. Shared objects connect Komas through
                  motion. Create a project, or open a .koma file, then build your sequence.
                </p>
                <p>
                  Want a starting point? Welcome offers{' '}
                  <strong>Solar system, Quarterly results and Rapunzel story</strong>. Each starter
                  supplies a Brand Kit, project instructions and a first chat request. Choose a
                  model and send the request to generate Komas.
                </p>
                <p>
                  For an open project, find starters in <strong>Settings → Templates</strong>.
                  Applying one replaces its Brand Kit and instructions and fills the chat request;
                  Undo restores the project changes.
                </p>
                <div className="flex flex-wrap gap-2">
                  {project === null && (
                    <Button variant="primary" onClick={() => visit(() => void createNewProject())}>
                      Create a project
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => settings('templates')}>
                    Browse starters & templates
                  </Button>
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <p>
                  A <strong>Brand Kit</strong> guides colours, fonts, logo, tone, visual style and
                  imagery. It goes with each generation request. Changing it does not restyle
                  existing Komas.
                </p>
                <ol className="list-decimal space-y-2 pl-5">
                  <li>
                    <strong>Create:</strong> open Brand Kit → This project, edit the fields and
                    choose Save to library.
                  </li>
                  <li>
                    <strong>Import from a deck:</strong> in Library, choose Create Brand Kit from
                    deck and select a PPTX or PDF (PPTX needs a local LibreOffice installation).
                    Review the prepared content before sending it to Claude Code / Opus. Mock
                    creates a local demonstration, not an analysis of your deck.
                  </li>
                  <li>
                    <strong>Review:</strong> inspect the proposal, warnings, evidence and
                    confidence. Edit colours, fonts and guidance, and confirm a logo candidate or
                    keep no logo. Choose Save new Brand Kit.
                  </li>
                  <li>
                    <strong>Create from brand material:</strong> in the chat Brand Kit picker,
                    choose Attach brand material, then Create Brand Kit and instructions. Review the
                    listed content before sending it, edit the proposal, then save or apply the kit
                    and instructions together.
                  </li>
                  <li>
                    <strong>Reuse:</strong> select the saved kit and Apply to this project, or
                    choose it beside Model in chat. Kits with instructions offer Apply kit and
                    instructions or Apply kit only in the library. Saving the proposal alone does
                    not apply it.
                  </li>
                </ol>
                <p>
                  The project copy is saved in its <strong>.koma file</strong>. The library lives in
                  Koma Motion’s app data on this computer. Applying a kit copies it into a project;
                  later library edits do not update that project.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={project === null}
                    onClick={() => brandKit(false)}
                  >
                    Edit project Brand Kit
                  </Button>
                  <Button
                    variant="outline"
                    disabled={project === null}
                    onClick={() => brandKit(true)}
                  >
                    Open Brand Kit library
                  </Button>
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <p>
                  <strong>Project instructions</strong> are lasting guidance for this presentation:
                  audience, language, structure or motion rules. For example: “Use plain English and
                  introduce one idea per Koma.” They accompany every request and are saved in the
                  .koma file.
                </p>
                <p>
                  The <strong>Brand Kit</strong> sets the visual identity and voice. A{' '}
                  <strong>chat request</strong> says what to make this time, such as “Explain our
                  quarterly results in five Komas.” The conversation is session-only; generation
                  history in the project records requests and summaries.
                </p>
                <p>
                  Write instructions in <strong>Settings → Instructions</strong>. In{' '}
                  <strong>Templates</strong>, save reusable instruction text in this app’s library
                  on this computer. Applying a template copies its text into the project. It does
                  not stay linked to the template.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={project === null}
                    onClick={() => settings('instructions')}
                  >
                    Open project instructions
                  </Button>
                  <Button variant="outline" onClick={() => settings('templates')}>
                    Open instruction templates
                  </Button>
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <p>
                  In chat, open <strong>Model</strong> to choose a provider and model. Model options
                  includes provider details and custom IDs; Settings → Providers explains
                  availability and sign-in requirements. External providers send your request and
                  project context online.
                </p>
                <p>
                  <strong>Mock</strong> runs locally and always makes the same three-Koma demo. Use
                  an available signed-in provider for a presentation based on your request. Model
                  choices are saved with the project; Koma Motion does not store provider sign-ins.
                </p>
                <p>
                  Review the Brand Kit and instructions, write your request, set{' '}
                  <strong>Koma count</strong>, then choose <strong>Generate Komas</strong>{' '}
                  (Ctrl/Command+Enter). Follow progress or Cancel. Successful generation replaces
                  the current Komas; review the result and use Undo if needed.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={project === null}
                    onClick={() =>
                      visit(() => {
                        const ui = useUiStore.getState();
                        ui.setView('canvas');
                        ui.setAgentPanelOpen(true);
                      }, '[data-guide-target="request"]')
                    }
                  >
                    Open chat
                  </Button>
                  <Button variant="outline" onClick={() => settings('providers')}>
                    Check providers
                  </Button>
                  <Button
                    variant="outline"
                    disabled={project === null}
                    onClick={() => settings('generation')}
                  >
                    Model settings
                  </Button>
                </div>
              </>
            )}
            {step === 4 && (
              <>
                <p>
                  Select a Koma, then an object on the canvas or in <strong>Layers</strong>. Drag to
                  move, resize or rotate; use the <strong>Inspector</strong> for precise values.
                  Enter edits selected text, Ctrl/Command+Enter finishes, and Escape discards the
                  text draft. Undo and Redo cover project edits.
                </p>
                <p>
                  If chat hides the Inspector in a narrow window, choose{' '}
                  <strong>Hide the chat</strong>. Use the Koma tab for frame details and Motion for
                  the next transition.
                </p>
                <p>
                  When motion is out of date, playback is blocked. Select its source Koma and open{' '}
                  <strong>Motion → Recalculate motion</strong> to repair it locally while preserving
                  timing. If offered, <strong>Regenerate transition</strong> in the Koma strip,
                  between the source and destination Komas, asks the selected provider for new
                  timing. Open Details on that transition to inspect the reason and both Komas.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={!project?.presentation.komas.length}
                    onClick={() => canvas(false)}
                  >
                    Open canvas & Inspector
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!project?.presentation.komas.length}
                    onClick={() => canvas(true)}
                  >
                    Inspect motion
                  </Button>
                </div>
              </>
            )}
            {step === 5 && (
              <>
                <p>
                  <strong>Preview plays one transition at a time.</strong> Select the first Koma and
                  choose Play below the canvas, or Preview in the top bar. Pause, scrub the position
                  or restart to inspect the motion. Playback lands on the next Koma; choose Play
                  again to continue through the sequence.
                </p>
                <p>
                  Use Previous Koma and Next Koma to navigate. With reduced motion enabled, previews
                  cut instead of moving.
                </p>
                <p>
                  <strong>Present plays the whole presentation.</strong> Choose Present in the top
                  bar, F5 from the beginning, or Shift+F5 from the selected Koma. Advance with the
                  arrow keys or turn on Autoplay, and choose Full screen when needed. Escape returns
                  to editing. If a transition cannot play, review it before choosing to return to
                  edit or cut across it.
                </p>
                <Button
                  variant="outline"
                  disabled={!project?.presentation.komas.length}
                  onClick={() =>
                    visit(() => {
                      const ui = useUiStore.getState();
                      ui.setView('canvas');
                      ui.setAgentPanelOpen(false);
                      ui.selectKoma(project?.presentation.komas[0]?.id ?? null);
                    }, '[data-guide-target="preview"]')
                  }
                >
                  Go to preview controls
                </Button>
              </>
            )}
            {step === 6 && (
              <>
                <p>
                  <strong>Save</strong> keeps the editable project, Brand Kit and instructions in a
                  .koma file. Use <strong>Export</strong> in the top bar to make editable PowerPoint
                  slides, then Choose destination.
                </p>
                <p>
                  Choose Static slides, Fade between slides or Morph matching objects. Fade and
                  Morph can advance automatically using transition timing. Review export warnings
                  before presenting.
                </p>
                <p>
                  <strong>Export limits:</strong> fonts may render differently; Morph needs a
                  compatible PowerPoint version. Staged motion, replacements and individual fades
                  can fall back to a slide fade. Exact choreography and easing are not preserved,
                  and groups are flattened. PDF, video and HTML export are not available.
                </p>
                <Button
                  variant="outline"
                  disabled={!project?.presentation.komas.length}
                  onClick={() => visit(() => undefined, '[data-guide-target="export"]')}
                >
                  Go to Export
                </Button>
              </>
            )}
          </div>
          {project === null && step > 0 && (
            <p className="mt-4 text-sm text-ink-400">
              Create or open a project to use project actions. You can keep reading without one.
            </p>
          )}
          {project !== null && project.presentation.komas.length === 0 && step >= 4 && (
            <p className="mt-4 text-sm text-ink-400">Generate or add Komas to use these actions.</p>
          )}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
          <label className="flex items-center gap-2 text-sm text-ink-300">
            <input
              type="checkbox"
              checked={completed}
              onChange={(event) => setCompleted(event.target.checked)}
            />
            Mark guide complete on this computer
          </label>
          <div className="flex gap-2">
            <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" onClick={() => setStep(step + 1)}>
                Next
              </Button>
            ) : (
              <Button variant="primary" onClick={close}>
                Done
              </Button>
            )}
          </div>
        </footer>
      </div>
    </ModalFrame>
  );
}
